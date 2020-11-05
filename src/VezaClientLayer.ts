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

import TranslationLayer from "./TranslationLayer";
import { NodeMessage, Client, ClientSocket } from "veza";
import { MSG_TYPE, RawMessage } from "./util";

export default class VezaClientLayer extends TranslationLayer {
    constructor(public client: Client) {
        super();

        this.client.setMaxListeners(0);
        this.client.on("message", this._onMessage.bind(this));
    }

    private _onMessage(message: NodeMessage, client: ClientSocket): void {
        this.emit(message.data.bus, message.data.payload, message.id, client);
    }

    send(bus: string, payload?: unknown): void {
        for (const [, server] of this.client.servers.entries())
            server.send({ bus, type: MSG_TYPE.RAW, payload }, { receptive: false }).catch(() => { /* Do nothing */ });
    }

    answer<T = any>(bus_wanted: string, handler: (payload: T) => (Promise<any> | any)): this {
        this.client.on("message", async (message: NodeMessage) => {
            const { bus: bus_gotten, payload } = message.data as RawMessage;

            if (bus_wanted !== bus_gotten) return;

            try {
                const response = await handler(payload);
                message.reply({ bus: bus_gotten, type: MSG_TYPE.RAW, payload: response });
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
                message.reply({ bus: bus_gotten, type: MSG_TYPE.ERROR, payload: response });
            }
        });

        return this;
    }

    async awaitAnswer<T = any>(bus_request: string, payload_request?: unknown, { timeout, filter }: { timeout?: number, filter?: RegExp | string } = {}): Promise<T> {
        const test = filter
            ? typeof filter === "string"
                ? (name: string) => name === filter
                : (name: string) => filter.test(name)
            : () => true;

        const promises: Promise<RawMessage>[] = [];
        for (const [name, client] of this.client.servers.entries()) {
            if (test(name)) promises.push(client.send(
                { bus: bus_request, type: MSG_TYPE.RAW, payload: payload_request },
                { receptive: true, timeout }
            ) as Promise<RawMessage>);
        }

        const { type: type_gotten, payload: payload_gotten } = await Promise.race(promises);
        switch (type_gotten) {
            case MSG_TYPE.ERROR: {
                if (payload_gotten.isError) {
                    throw Object.assign(new Error(), payload_gotten);
                }
                throw payload_gotten;
            }
            default: {
                return payload_gotten;
            }
        }
    }

    destroy(): void {
        super.destroy();
        this.client.removeAllListeners();
    }
}
