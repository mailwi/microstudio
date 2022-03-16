this.Runner = (function() {
  function Runner(microvm) {
    this.microvm = microvm;
  }

  Runner.prototype.init = function() {
    this.initialized = true;
    this.system = this.microvm.context.global.system;
    this.system.preemptive = 1;
    this.main_thread = new Thread(this);
    this.threads = [this.main_thread];
    this.current_thread = this.main_thread;
    this.thread_index = 0;
    this.microvm.context.global.print = this.microvm.context.meta.print;
    this.microvm.context.global.random = new Random(0);
    this.fps = 60;
    this.fps_max = 60;
    return this.microvm.context.meta.print("microScript 2.0 - alpha");
  };

  Runner.prototype.run = function(src, filename) {
    var compiler, err, parser, program, result;
    if (!this.initialized) {
      this.init();
    }
    parser = new Parser(src, filename);
    parser.parse();
    if (parser.error_info != null) {
      err = parser.error_info;
      err.type = "compile";
      throw err;
    }
    program = parser.program;
    compiler = new Compiler(program);
    result = null;
    compiler.routine.callback = function(res) {
      return result = res;
    };
    this.main_thread.addCall(compiler.routine);
    this.tick();
    return result;
  };

  Runner.prototype.call = function(name, args) {
    var compiler, parser, processor, program, src;
    if (name === "draw" || name === "update") {
      if (this.microvm.context.global[name] != null) {
        this.main_thread.addCall(name + "()");
      }
      if (name === "draw") {
        this.tick();
      }
      return;
    }
    if (this.microvm.context.global[name] != null) {
      src = name + "()";
      parser = new Parser(src, "");
      parser.parse();
      program = parser.program;
      compiler = new Compiler(program);
      processor = this.main_thread.processor;
      processor.time_limit = Date.now() + 16;
      processor.load(compiler.routine);
      return processor.run(this.microvm.context);
    } else {
      return 0;
    }
  };

  Runner.prototype.process = function(thread, time_limit) {
    var processor;
    processor = thread.processor;
    processor.time_limit = time_limit;
    this.current_thread = thread;
    return processor.run(this.microvm.context);
  };

  Runner.prototype.tick = function() {
    var frame_time, i, j, k, len, margin, processing, processor, ref, ref1, t, time, time_limit;
    if (this.system.fps != null) {
      this.fps = this.fps * .9 + this.system.fps * .1;
    }
    this.fps_max = Math.max(this.fps, this.fps_max);
    frame_time = Math.min(16, Math.floor(1000 / this.fps_max));
    if (this.fps < 59) {
      margin = 10;
    } else {
      margin = Math.floor(1000 / this.fps * .8);
    }
    console.info(margin);
    time = Date.now();
    time_limit = time + 32;
    processor = this.main_thread.processor;
    if (!processor.done) {
      if (this.main_thread.sleep_until != null) {
        if (Date.now() >= this.main_thread.sleep_until) {
          delete this.main_thread.sleep_until;
          this.process(this.main_thread, time_limit);
        }
      } else {
        this.process(this.main_thread, time_limit);
      }
    }
    while (processor.done && Date.now() < time_limit && this.main_thread.loadNext()) {
      this.process(this.main_thread, time_limit);
    }
    time_limit = time + margin;
    processing = true;
    while (processing) {
      processing = false;
      ref = this.threads;
      for (j = 0, len = ref.length; j < len; j++) {
        t = ref[j];
        if (t !== this.main_thread) {
          if (t.paused) {
            continue;
          }
          processor = t.processor;
          if (!processor.done) {
            if (t.sleep_until != null) {
              if (Date.now() >= t.sleep_until) {
                delete t.sleep_until;
                this.process(t, time_limit);
                processing = true;
              }
            } else {
              this.process(t, time_limit);
              processing = true;
            }
          } else if (t.start_time != null) {
            if (t.repeat) {
              while (time >= t.start_time) {
                if (time >= t.start_time + 150) {
                  t.start_time = time + t.delay;
                } else {
                  t.start_time += t.delay;
                }
                processor.load(t.routine);
                this.process(t, time_limit);
                processing = true;
              }
            } else {
              if (time >= t.start_time) {
                delete t.start_time;
                processor.load(t.routine);
                this.process(t, time_limit);
                processing = true;
              }
            }
          } else {
            t.terminated = true;
          }
        }
      }
      if (Date.now() > time_limit) {
        break;
      }
    }
    for (i = k = ref1 = this.threads.length - 1; k >= 1; i = k += -1) {
      t = this.threads[i];
      if (t.terminated) {
        this.threads.splice(i, 1);
      }
    }
  };

  Runner.prototype.createThread = function(routine, delay, repeat) {
    var t;
    t = new Thread(this);
    t.routine = routine;
    this.threads.push(t);
    t.start_time = Date.now() + delay;
    if (repeat) {
      t.repeat = repeat;
      t.delay = delay;
    }
    return t["interface"];
  };

  Runner.prototype.sleep = function(value) {
    if (this.current_thread != null) {
      return this.current_thread.sleep_until = Date.now() + Math.max(0, value);
    }
  };

  return Runner;

})();

this.Thread = (function() {
  function Thread(runner) {
    this.runner = runner;
    this.loop = false;
    this.processor = new Processor(this.runner);
    this.paused = false;
    this.terminated = false;
    this.next_calls = [];
    this["interface"] = {
      pause: (function(_this) {
        return function() {
          return _this.pause();
        };
      })(this),
      resume: (function(_this) {
        return function() {
          return _this.resume();
        };
      })(this),
      stop: (function(_this) {
        return function() {
          return _this.stop();
        };
      })(this),
      status: "running"
    };
  }

  Thread.prototype.addCall = function(call) {
    if (this.next_calls.indexOf(call) < 0) {
      return this.next_calls.push(call);
    }
  };

  Thread.prototype.loadNext = function() {
    var compiler, f, parser, program;
    if (this.next_calls.length > 0) {
      f = this.next_calls.splice(0, 1)[0];
      if (f instanceof Routine) {
        this.processor.load(f);
      } else {
        parser = new Parser(f, "");
        parser.parse();
        program = parser.program;
        compiler = new Compiler(program);
        this.processor.load(compiler.routine);
      }
      return true;
    } else {
      return false;
    }
  };

  Thread.prototype.pause = function() {
    if (this["interface"].status === "running") {
      this["interface"].status = "paused";
      return this.paused = true;
    }
  };

  Thread.prototype.resume = function() {
    if (this["interface"].status === "paused") {
      this["interface"].status = "running";
      return this.paused = false;
    }
  };

  Thread.prototype.stop = function() {
    this["interface"].status = "stopped";
    return this.terminated = true;
  };

  return Thread;

})();
