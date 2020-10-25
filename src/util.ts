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

export enum MSG_TYPE {
    RAW,
    ERROR
}

/**
 * @param {number} ms Delay in milliseconds
 * @param {boolean} [thrw=false] Wether to throw instead of resolving
 * @returns {Promise<void>}
 */
export function timeout(ms: number, thrw = false): Promise<void> {
    return new Promise((res, rej) => setTimeout(thrw ? rej : res, ms));
}

export interface RawMessage {
    bus: string;
    payload: any;
    type: MSG_TYPE;
}

export interface AwaitAnswerOptions {
    timeout?: number;
}
