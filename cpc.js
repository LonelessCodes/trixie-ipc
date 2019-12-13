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

const uuid = require("uuid");
const events = require("events");

/**
 * @param {number} ms Delay in milliseconds
 * @returns {Promise<void>}
 */
function timeout(ms) {
    return new Promise(res => setTimeout(res, ms));
}

class CPC extends events.EventEmitter {
    constructor(child) {
        super();

        this.setMaxListeners(0);

        this.child = child;
        this.child.setMaxListeners(0);

        this.child.on("message", this.onMessage.bind(this));
    }

    onMessage({ bus, payload }) {
        this.emit(bus, payload);
    }

    send(bus, payload) {
        if (this.child.send)
            this.child.send({ bus, type: CPC.TYPE.RAW, payload });
    }

    answer(busWanted, handler) {
        this.child.on("message", async ({ bus: busGotten, id, payload }) => {
            if (busWanted !== busGotten) return;

            try {
                const response = await handler(payload);
                if (this.child.send)
                    this.child.send({ bus: busGotten, id, type: CPC.TYPE.RAW, payload: response });
            } catch (err) {
                let response = err;
                if (err instanceof Error) {
                    response = {
                        isError: true,
                        name: err.name,
                        message: err.message,
                        stack: err.stack,
                    };
                }
                if (this.child.send)
                    this.child.send({ bus: busGotten, id, type: CPC.TYPE.ERROR, payload: response });
            }
        });

        return this;
    }

    awaitAnswer(busRequest, payloadRequest, opts = {}) {
        const p = new Promise((resolve, reject) => {
            const idRequest = uuid.v1();

            const removeHandlers = () => {
                this.child.removeListener("exit", exitHandler);
                this.child.removeListener("message", handler);
            };
            const exitHandler = () => {
                removeHandlers();
                reject(new Error("Child died while processing"));
            };
            const handler = ({ bus: busGotten, id: idGotten, type: typeGotten, payload: payloadGotten }) => {
                if (idRequest !== idGotten) return;
                if (busRequest !== busGotten) return;

                removeHandlers();
                switch (typeGotten) {
                    case CPC.TYPE.ERROR: {
                        if (payloadGotten.isError) {
                            return reject(Object.assign(new Error(), payloadGotten));
                        }
                        return reject(payloadGotten);
                    }
                    case CPC.TYPE.RAW: {
                        return resolve(payloadGotten);
                    }
                }
            };
            this.child.on("exit", exitHandler);
            this.child.on("message", handler);

            if (this.child.send)
                this.child.send({ bus: busRequest, id: idRequest, type: CPC.TYPE.RAW, payload: payloadRequest });
        });
        if (opts.timeout) {
            return Promise.race([
                p,
                timeout(opts.timeout).then(() => {
                    throw new Error("Exceeded ipc timeout.");
                }),
            ]);
        }
        return p;
    }

    destroy() {
        this.removeAllListeners();
        this.child.removeAllListeners();
    }
}
CPC.TYPE = Object.freeze({
    RAW: 0,
    ERROR: 1,
});

module.exports = child => new CPC(child);
