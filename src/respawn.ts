/*
 * Copyright (C) 2018-2020 Christian Schäfer / Loneless
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

import { EventEmitter } from "events";
import { fork, exec, spawn, ChildProcess, ForkOptions, SpawnOptions, StdioOptions, Serializable } from "child_process";
import ps from "ps-tree";
import { platform } from "os";
import { Writable } from "stream";
import { ChildEndpoint } from "./util";

function kill(pid: number, sig?: string | number) {
    if (platform() === "win32") {
        exec("taskkill /pid " + pid + " /T /F");
        return;
    }
    ps(pid, (_, pids_s) => {
        const pids = (pids_s || []).map(item => parseInt(item.PID, 10));

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

function defaultSleep(sleep?: number | number[]) {
    const arr: number[] = Array.isArray(sleep) ? sleep : [sleep || 1000];
    return function getSleep(restarts: number): number {
        return arr[restarts - 1] || arr[arr.length - 1];
    };
}

enum STATUS {
    STOPPED,
    STOPPING,
    RUNNING,
    SLEEPING,
    CRASHED,
}

type Options = ForkOptions | SpawnOptions;
type MonitorOptions = Options & {
    name?: string;
    silent?: boolean;
    fork?: boolean;
    sleep?: ((restarts: number) => number) | number | number[];
    maxRestarts?: number;
    kill?: number | false;

    stdout?: Writable;
    stderr?: Writable;
};

class Monitor extends EventEmitter implements ChildEndpoint {
    id?: number = undefined; // For respawn-group

    status: STATUS = STATUS.STOPPED;
    command: string[];
    name?: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    uid?: number;
    gid?: number;
    pid?: number = 0;
    stdio?: StdioOptions;
    stdout?: Writable;
    stderr?: Writable;
    silent: boolean;
    windowsVerbatimArguments?: boolean;
    crashes: number = 0;
    crashed: boolean = false;
    fork: boolean;

    sleep: (restarts: number) => number;
    maxRestarts: number;
    kill: number;

    child?: ChildProcess = undefined;
    started?: Date = undefined;
    timeout?: NodeJS.Timeout = undefined;

    constructor(command: string[], opts: MonitorOptions = {}) {
        super();

        this.command = command;
        this.name = opts.name;
        this.cwd = opts.cwd || ".";
        this.env = opts.env || {};
        this.uid = opts.uid;
        this.gid = opts.gid;
        this.stdio = opts.stdio;
        this.stdout = opts.stdout;
        this.stderr = opts.stderr;
        this.silent = opts.silent || false;
        this.windowsVerbatimArguments = opts.windowsVerbatimArguments;
        this.fork = !!opts.fork;

        this.sleep = typeof opts.sleep === "function" ? opts.sleep : defaultSleep(opts.sleep);
        this.maxRestarts = opts.maxRestarts === 0 ? 0 : opts.maxRestarts || -1;
        this.kill = opts.kill === false ? 0 : opts.kill || 30000;
    }

    stop(cb: () => void) {
        if (this.status === STATUS.STOPPED || this.status === STATUS.STOPPING) return cb && cb();
        this.status = STATUS.STOPPING;

        if (this.timeout) clearTimeout(this.timeout);

        if (cb) {
            if (this.child) this.child.on("exit", cb);
            else process.nextTick(cb);
        }

        if (!this.child) return this._stopped();

        const sigkill = () => {
            if (this.child) kill(this.child.pid, "SIGKILL");
            this.emit("force-kill");
        };

        let wait: NodeJS.Timeout;
        const onexit = () => clearTimeout(wait);

        if (this.kill !== 0) {
            wait = setTimeout(sigkill, this.kill);
            this.child.on("exit", onexit);
        }

        kill(this.child.pid);
    }

    restart() {
        if (this.status === STATUS.RUNNING) return this;

        let restarts = 0;
        let clock = 60000;

        const loop = () => {
            const child = this.fork
                ? fork(this.command[0], this.command.slice(1), {
                    cwd: this.cwd,
                    env: { ...process.env, ...this.env },
                    uid: this.uid,
                    gid: this.gid,
                    stdio: this.stdio,
                    silent: this.silent,
                    windowsVerbatimArguments: this.windowsVerbatimArguments,
                })
                : spawn(this.command[0], this.command.slice(1), {
                    cwd: this.cwd,
                    env: { ...process.env, ...this.env },
                    uid: this.uid,
                    gid: this.gid,
                    stdio: this.stdio,
                    windowsVerbatimArguments: this.windowsVerbatimArguments,
                });

            this.started = new Date();
            this.status = STATUS.RUNNING;
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
                this.child = undefined;
                this.pid = 0;
                return true;
            };

            child.on("error", err => {
                this.emit("warn", err); // Too opionated? maybe just forward err
                if (!clear()) return;
                if (this.status === STATUS.STOPPING) return this._stopped();
                this._crash();
            });

            child.on("exit", (code, signal) => {
                this.emit("exit", code, signal);
                if (!clear()) return;
                if (this.status === STATUS.STOPPING) return this._stopped();

                clock -= Date.now() - (this.started ? this.started.getTime() : 0);

                if (clock <= 0) {
                    clock = 60000;
                    restarts = 0;
                }

                if (++restarts > this.maxRestarts && this.maxRestarts !== -1) return this._crash();

                this.status = STATUS.SLEEPING;
                this.emit("sleep");

                const restartTimeout = this.sleep(restarts);
                this.timeout = setTimeout(loop, restartTimeout);
            });
        };

        if (this.timeout) clearTimeout(this.timeout);
        loop();
        this.emit("start");

        return this;
    }

    send(data: Serializable) {
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
        };

        if (!doc.id) delete doc.id;
        if (!doc.pid) delete doc.pid;
        if (!doc.name) delete doc.name;
        if (!doc.started) delete doc.started;

        return doc;
    }

    _crash() {
        if (this.status !== STATUS.RUNNING) return;
        this.status = STATUS.CRASHED;
        this.crashes++;
        this.emit("crash");
        this._stopped();
    }

    _stopped() {
        if (this.status === STATUS.STOPPED) return;
        if (this.status !== STATUS.CRASHED) this.status = STATUS.STOPPED;
        this.started = undefined;
        this.emit("stop");
    }
}

export default function respawn(command: string[] | string, opts: MonitorOptions): Monitor;
export default function respawn(opts: MonitorOptions & { command: string[] }): Monitor;

export default function respawn(
    command: string[] | string
    | (MonitorOptions & { command: string[] }),
    opts?: MonitorOptions
): Monitor {
    if (typeof command === "object" && !Array.isArray(command)) return respawn(command.command, command);
    return new Monitor(Array.isArray(command) ? command : [command], opts || {});
}
