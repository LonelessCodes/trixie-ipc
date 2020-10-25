/*
 * Copyright (C) 2018-2019 Christian Schäfer / Loneless
 *
 * TrixieBot is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * TrixieBot is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const events = require("events");
const { fork, exec, spawn } = require("child_process");
const ps = require("ps-tree");
const os = require("os");

function kill(pid, sig) {
    if (os.platform() === "win32") {
        exec("taskkill /pid " + pid + " /T /F");
        return;
    }
    ps(pid, (_, pids) => {
        pids = (pids || []).map(item => parseInt(item.PID, 10));

        pids.push(pid);

        pids.forEach(pid => {
            try {
                process.kill(pid, sig);
            } catch (err) {
                // Do nothing
            }
        });
    });
}

function defaultSleep(sleep) {
    sleep = Array.isArray(sleep) ? sleep : [sleep || 1000];
    return function getSleep(restarts) {
        return sleep[restarts - 1] || sleep[sleep.length - 1];
    };
}

class Monitor extends events.EventEmitter {
    constructor(command, opts) {
        super();

        this.id = null; // For respawn-group

        this.status = "stopped";
        this.command = command;
        this.name = opts.name;
        this.cwd = opts.cwd || ".";
        this.env = opts.env || {};
        this.data = opts.data || {};
        this.uid = opts.uid;
        this.gid = opts.gid;
        this.pid = 0;
        this.crashes = 0;
        this.stdio = opts.stdio;
        this.stdout = opts.stdout;
        this.stderr = opts.stderr;
        this.silent = opts.silent;
        this.windowsVerbatimArguments = opts.windowsVerbatimArguments;
        this.spawnFn = opts.fork ? fork : spawn;

        this.crashed = false;
        this.sleep = typeof opts.sleep === "function" ? opts.sleep : defaultSleep(opts.sleep);
        this.maxRestarts = opts.maxRestarts === 0 ? 0 : opts.maxRestarts || -1;
        this.kill = opts.kill === false ? false : opts.kill || 30000;

        this.child = null;
        this.started = null;
        this.timeout = null;
    }

    stop(cb) {
        if (this.status === "stopped" || this.status === "stopping") return cb && cb();
        this.status = "stopping";

        clearTimeout(this.timeout);

        if (cb) {
            if (this.child) this.child.on("exit", cb);
            else process.nextTick(cb);
        }

        if (!this.child) return this._stopped();

        const sigkill = () => {
            kill(this.child.pid, "SIGKILL");
            this.emit("force-kill");
        };

        let wait;
        const onexit = () => clearTimeout(wait);

        if (this.kill !== false) {
            wait = setTimeout(sigkill, this.kill);
            this.child.on("exit", onexit);
        }

        kill(this.child.pid);
    }

    restart() {
        if (this.status === "running") return this;

        let restarts = 0;
        let clock = 60000;

        const loop = () => {
            const cmd = typeof this.command === "function" ? this.command() : this.command;
            const child = this.spawnFn(cmd[0], cmd.slice(1), {
                cwd: this.cwd,
                env: { ...process.env, ...this.env },
                uid: this.uid,
                gid: this.gid,
                stdio: this.stdio,
                silent: this.silent,
                windowsVerbatimArguments: this.windowsVerbatimArguments,
            });

            this.started = new Date();
            this.status = "running";
            this.child = child;
            this.pid = child.pid;
            this.emit("spawn", child);

            child.setMaxListeners(0);

            if (child.stdout) {
                child.stdout.on("data", data => {
                    this.emit("stdout", data);
                });

                if (this.stdout) {
                    child.stdout.pipe(this.stdout);
                }
            }

            if (child.stderr) {
                child.stderr.on("data", data => {
                    this.emit("stderr", data);
                });

                if (this.stderr) {
                    child.stderr.pipe(this.stderr);
                }
            }

            child.on("message", message => {
                this.emit("message", message);
            });

            const clear = () => {
                if (this.child !== child) return false;
                this.child = null;
                this.pid = 0;
                return true;
            };

            child.on("error", err => {
                this.emit("warn", err); // Too opionated? maybe just forward err
                if (!clear()) return;
                if (this.status === "stopping") return this._stopped();
                this._crash();
            });

            child.on("exit", (code, signal) => {
                this.emit("exit", code, signal);
                if (!clear()) return;
                if (this.status === "stopping") return this._stopped();

                clock -= Date.now() - (this.started ? this.started.getTime() : 0);

                if (clock <= 0) {
                    clock = 60000;
                    restarts = 0;
                }

                if (++restarts > this.maxRestarts && this.maxRestarts !== -1) return this._crash();

                this.status = "sleeping";
                this.emit("sleep");

                const restartTimeout = this.sleep(restarts);
                this.timeout = setTimeout(loop, restartTimeout);
            });
        };

        clearTimeout(this.timeout);
        loop();

        if (this.status === "running") this.emit("start");

        return this;
    }

    send(data) {
        if (!this.child) return;
        this.child.send(data);
    }

    toJSON() {
        const doc = {
            id: this.id,
            name: this.name,
            status: this.status,
            started: this.started,
            pid: this.pid,
            crashes: this.crashes,
            command: this.command,
            cwd: this.cwd,
            env: this.env,
            data: this.data,
        };

        if (!doc.id) delete doc.id;
        if (!doc.pid) delete doc.pid;
        if (!doc.name) delete doc.name;
        if (!doc.data) delete doc.data;
        if (!doc.started) delete doc.started;

        return doc;
    }

    _crash() {
        if (this.status !== "running") return;
        this.status = "crashed";
        this.crashes++;
        this.emit("crash");
        if (this.status === "crashed") this._stopped();
    }

    _stopped() {
        if (this.status === "stopped") return;
        if (this.status !== "crashed") this.status = "stopped";
        this.started = null;
        this.emit("stop");
    }
}

/**
 * @param {string[]|string} command
 * @param {{}} opts
 * @returns {Monitor}
 */
function respawn(command, opts) {
    if (typeof command === "object" && !Array.isArray(command)) return respawn(command.command, command);
    if (!Array.isArray(command)) command = [command];
    return new Monitor(command, opts || {});
}

module.exports.default = respawn;
