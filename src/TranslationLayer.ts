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

import { EventEmitter } from "events";
import { AwaitAnswerOptions } from "./util";

export default abstract class TranslationLayer extends EventEmitter {
    public abstract send(bus: string, payload: unknown): void;
    public abstract answer(bus: string, handler: (payload: unknown) => (Promise<any> | any)): this;
    public abstract awaitAnswer(bus: string, payload: unknown, opts?: AwaitAnswerOptions): Promise<unknown>;

    destroy(): void {
        this.removeAllListeners();
    }
}
