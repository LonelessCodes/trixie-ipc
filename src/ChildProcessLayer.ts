/*
 * Copyright (C) 2020 Christian Schäfer / Loneless
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

import uuid from "uuid";
import TranslationLayer from "./TranslationLayer";
import { MSG_TYPE, RawMessage, timeout, AwaitAnswerOptions, ChildEndpoint } from "./util";

interface ChildProcessRawMessage extends RawMessage {
    id: string;
}

export default class ChildProcessLayer extends TranslationLayer {
    constructor(public child: ChildEndpoint) {
        super();

        this.child.setMaxListeners(0);
        this.child.on("message", this._onMessage.bind(this));
    }

    private _onMessage(msg: ChildProcessRawMessage): void {
        this.emit(msg.bus, msg.payload);
    }

    send(bus: string, payload: unknown): void {
        if (this.child.killed) {
            return;
        }

        this.child.send({ bus, type: MSG_TYPE.RAW, payload });
    }

    answer(bus_wanted: string, handler: (payload: unknown) => (Promise<any> | any)): this {
        this.child.on("message", async ({ bus: bus_gotten, id, payload }: ChildProcessRawMessage) => {
            if (bus_wanted !== bus_gotten) return;

            try {
                const response = await handler(payload);
                this.child.send({ bus: bus_gotten, id, type: MSG_TYPE.RAW, payload: response });
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
                this.child.send({ bus: bus_gotten, id, type: MSG_TYPE.ERROR, payload: response });
            }
        });

        return this;
    }

    awaitAnswer(bus_request: string, payload_request: unknown, opts: AwaitAnswerOptions = {}): Promise<unknown> {
        const p = new Promise((resolve, reject) => {
            const idRequest = uuid.v1();

            const removeHandlers = () => {
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                this.child.off("exit", exitHandler);
                // eslint-disable-next-line @typescript-eslint/no-use-before-define
                this.child.off("message", handler);
            };
            const exitHandler = () => {
                removeHandlers();
                reject(new Error("Child died while processing"));
            };
            const handler = ({ bus: busGotten, id: idGotten, type: typeGotten, payload: payloadGotten }) => {
                if (idRequest !== idGotten) return;
                if (bus_request !== busGotten) return;

                removeHandlers();
                switch (typeGotten) {
                    case MSG_TYPE.ERROR: {
                        if (payloadGotten.isError) {
                            return reject(Object.assign(new Error(), payloadGotten));
                        }
                        return reject(payloadGotten);
                    }
                    case MSG_TYPE.RAW: {
                        return resolve(payloadGotten);
                    }
                }
            };
            this.child.on("exit", exitHandler);
            this.child.on("message", handler);

            this.child.send({ bus: bus_request, id: idRequest, type: MSG_TYPE.RAW, payload: payload_request });
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

    destroy(): void {
        this.removeAllListeners();
        this.child.removeAllListeners();
    }
}
