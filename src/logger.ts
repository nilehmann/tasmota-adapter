/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

let debugLogger: (message?: any, ...optionalParams: any[]) => void = () => { }

export function setup(debug: boolean): void {
    if (debug === true) {
        debugLogger = console.log;
    }
}

export function debug(message?: any, ...optionalParams: any[]): void {
    debugLogger(message, optionalParams);
}
