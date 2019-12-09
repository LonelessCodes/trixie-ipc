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
// eslint-disable-next-line no-unused-vars
const Server = require("node-ipc/dao/socketServer.js");

/*
* CPC Interface
* @exit
* @message => data
* #send(data)
*/

class IPCServerAdapter extends events.EventEmitter {
    /**
     * Put a node-ipc server instance in a nice little wrapper to use with
     * trixie-ipc instance
     *
     * Usage:
     * ```
    const ipc = require("node-ipc");
    const IPCServerAdapter = require("trixie-ipc/IPCServerAdapter");
    const cpc = require("./cpc");

    ipc.serve();

    module.exports = cpc(new IPCServerAdapter(ipc.server));

    ipc.server.start();
       ```
     *
     * @param {Server} server
     */
    constructor(server) {
        super();

        this._server = server;
        this._server.on("message", data => this.emit("message", data));

        this._sockets = [];

        this._promiseStart = new Promise(resolve => {
            this._server.on("start", () => {
                this._server.on("connect", socket => {
                    while (this._sockets.length > 0) {
                        this._sockets[0].end();
                        this._sockets.splice(0, 1);
                        this.emit("exit");
                    }
                    this._sockets.push(socket);

                    this.emit("connect", socket.id);

                    resolve();
                });

                this._server.on("socket.disconnect", (socket, socketId) => {
                    if (this._sockets.length === 0) return;
                    const i = this._sockets.findIndex(s => socketId === s.id);
                    if (i >= 0) {
                        this._sockets.splice(i, 1);
                        this.emit("exit");
                    }

                    this.emit("disconnect", socketId);
                });
            });
        });
    }

    _getSocket() {
        if (this._sockets.length === 0) return;
        return this._sockets[0];
    }

    /**
     * @param {any} data
     */
    send(data) {
        this._promiseStart.then(() => {
            const socket = this._getSocket();
            if (!socket) throw new Error("No socket connected");
            this._server.emit(socket, "message", data);
        });
    }
}

module.exports = IPCServerAdapter;
