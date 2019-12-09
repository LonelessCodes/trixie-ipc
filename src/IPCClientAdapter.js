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

class IPCClientAdapter extends events.EventEmitter {
    constructor(client) {
        super();

        this.client = client;

        this.connected = false;

        this.promiseStart = new Promise(resolve => {
            this.client.on("connect", () => {
                this.connected = true;
                this.emit("connect");
                resolve();
            });
            this.client.on("disconnect", () => {
                if (!this.connected) return;
                this.connected = false;
                this.emit("disconnect");
                this.emit("exit");
            });

            this.client.on("message", data => this.emit("message", data));
        });
    }

    send(data) {
        this.promiseStart.then(() => {
            if (!this.client) throw new Error("Not connected to trixiebot");
            this.client.emit("message", data);
        });
    }
}

module.exports = IPCClientAdapter;
