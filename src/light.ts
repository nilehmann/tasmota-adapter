/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import { Adapter, Device, Property } from 'gateway-addon';
import { CommandResult, getStatus, setStatus } from './api';
import { kelvinToTasmota, tasmotaToKelvin } from './ct-conversion';
import { debug } from './logger';

class PollingProperty<T> extends Property {
    constructor(device: Device, name: string, propertyDescr: {}, private poll: () => Promise<void>) {
        super(device, name, propertyDescr);
    }

    update(value: T) {
        this.setCachedValueAndNotify(value);
    }

    public startPolling(intervalMs: number) {
        setInterval(() => this.poll(), intervalMs);
    }
}

class WritableProperty<T> extends PollingProperty<T> {
    constructor(private device: Device, name: string, propertyDescr: {}, private set: (value: T) => Promise<void>, poll: () => Promise<void>) {
        super(device, name, propertyDescr, poll);
    }

    async setValue(value: T) {
        try {
            debug(`Set value of ${this.device.name} / ${this.title} to ${value}`);
            await super.setValue(value);
            this.set(value);
        } catch (e) {
            debug(`Could not set value: ${e}`);
        }
    }
}

class OnOffProperty extends WritableProperty<boolean> {
    constructor(device: Device, host: string, password: string) {
        super(device, 'on', {
            '@type': 'OnOffProperty',
            type: 'boolean',
            title: 'On',
            description: 'Whether the device is on or off'
        },
            async value => {
                const status = value ? 'ON' : 'OFF';
                const result = await setStatus(host, password, 'Power', status);

                if (result.status != 200) {
                    debug(`Could not set status: ${result.statusText} (${result.status})`);
                } else {
                    const json: CommandResult = await result.json();

                    if (json.WARNING) {
                        if (json.WARNING) {
                            debug(`Could not set status: ${json.WARNING}`);
                        }

                        if (json.Command) {
                            debug(`Could not set status: ${json.Command}`);
                        }
                    }
                }
            },
            async () => {
                const response = await getStatus(host, password, 'Power');
                const result = await response.json();
                this.update(result.POWER == 'ON');
            });
    }
}

class ColorProperty extends WritableProperty<string> {
    private channels: number;
    constructor(device: Device, host: string, password: string, manifest: any) {
        super(device, 'color', {
            '@type': 'ColorProperty',
            type: 'string',
            title: 'Color',
            description: 'The color of the light'
        },
            async value => {
                const {
                    experimental
                } = manifest.moziot.config;

                if (experimental?.useWhiteLedInColorMode) {
                    // If the color would be the same on all channels swap to the white channel.
                    const grey = '#' + value.substring(1, 3).repeat(3);

                    if (this.channels > 3 && value == grey) {
                        value = '#000000' + value.substring(1, 3);
                    }
                }

                const result = await setStatus(host, password, 'Color', value);

                if (result.status != 200) {
                    debug(`Could not set status: ${result.statusText} (${result.status})`);
                } else {
                    const json: CommandResult = await result.json();

                    if (json.WARNING) {
                        if (json.WARNING) {
                            debug(`Could not set status: ${json.WARNING}`);
                        }

                        if (json.Command) {
                            debug(`Could not set status: ${json.Command}`);
                        }
                    }
                }
            },
            async () => {
                const response = await getStatus(host, password, 'Color');
                const result = await response.json();
                const color: string = result?.Color || "";
                // Remember the number of channels for future checks.
                if (this.channels == 0) {
                    this.channels = color.length / 2;
                }
                var rgbColor = color.substring(0, 6);
                // If the color is black and there is a white channel display grey
                if (rgbColor == '000000' && color.length == 8) {
                    rgbColor = color.substring(6, 8).repeat(3);
                }
                this.update(`#${rgbColor.toLowerCase()}`);
            });
        this.channels = 0;
    }
}

class BrightnessProperty extends WritableProperty<number> {
    constructor(device: Device, host: string, password: string) {
        super(device, 'brightness', {
            '@type': 'BrightnessProperty',
            type: 'integer',
            title: 'Brightness',
            description: 'The brightness of the light'
        },
            async value => {
                const result = await setStatus(host, password, 'Dimmer', `${value}`);

                if (result.status != 200) {
                    debug(`Could not set status: ${result.statusText} (${result.status})`);
                } else {
                    const json: CommandResult = await result.json();

                    if (json.WARNING) {
                        if (json.WARNING) {
                            debug(`Could not set status: ${json.WARNING}`);
                        }

                        if (json.Command) {
                            debug(`Could not set status: ${json.Command}`);
                        }
                    }
                }
            },
            async () => {
                const response = await getStatus(host, password, 'Dimmer');
                const result = await response.json();
                this.update(result.Dimmer);
            });
    }
}

class ColorTemperatureProperty extends WritableProperty<number> {
    constructor(device: Device, host: string, password: string) {
        super(device, 'colorTemperature', {
            '@type': 'ColorTemperatureProperty',
            type: 'integer',
            title: 'Color Temperature',
            description: 'The color temperature of the light',
            minimum: 2700,
            maximum: 6500
        },
            async value => {
                const result = await setStatus(host, password, 'CT', `${kelvinToTasmota(value)}`);

                if (result.status != 200) {
                    debug(`Could not set status: ${result.statusText} (${result.status})`);
                } else {
                    const json: CommandResult = await result.json();

                    if (json.WARNING) {
                        if (json.WARNING) {
                            debug(`Could not set status: ${json.WARNING}`);
                        }

                        if (json.Command) {
                            debug(`Could not set status: ${json.Command}`);
                        }
                    }
                }
            },
            async () => {
                const response = await getStatus(host, password, 'CT');
                const result = await response.json();
                if (result) {
                    this.update(tasmotaToKelvin(result?.CT));
                }
            });
    }
}

export class DimmableLight extends Device {
    private onOffProperty: OnOffProperty;
    private brightnessProperty: BrightnessProperty;

    constructor(adapter: Adapter, id: string, host: string, password: string) {
        super(adapter, id);
        this['@context'] = 'https://iot.mozilla.org/schemas/';
        this['@type'] = ['Light'];
        this.name = id;

        this.onOffProperty = new OnOffProperty(this, host, password);
        this.addProperty(this.onOffProperty);


        this.brightnessProperty = new BrightnessProperty(this, host, password);
        this.addProperty(this.brightnessProperty);
    }

    addProperty(property: Property) {
        this.properties.set(property.name, property);
    }

    public startPolling(intervalMs: number) {
        this.onOffProperty.startPolling(intervalMs);
        this.brightnessProperty.startPolling(intervalMs);
    }
}

export class ColorTemperatureLight extends DimmableLight {
    private colorTemperatureProperty: ColorTemperatureProperty;

    constructor(adapter: Adapter, id: string, host: string, password: string) {
        super(adapter, id, host, password);
        this['@context'] = 'https://iot.mozilla.org/schemas/';
        this['@type'] = ['Light'];
        this.name = id;

        this.colorTemperatureProperty = new ColorTemperatureProperty(this, host, password);
        this.addProperty(this.colorTemperatureProperty);
    }

    addProperty(property: Property) {
        this.properties.set(property.name, property);
    }

    public startPolling(intervalMs: number) {
        super.startPolling(intervalMs);

        this.colorTemperatureProperty.startPolling(intervalMs);
    }
}

export class ColorLight extends DimmableLight {
    private colorProperty: ColorProperty;

    constructor(adapter: Adapter, id: string, host: string, password: string, manifest: any) {
        super(adapter, id, host, password);
        this['@context'] = 'https://iot.mozilla.org/schemas/';
        this['@type'] = ['Light'];
        this.name = id;

        this.colorProperty = new ColorProperty(this, host, password, manifest);
        this.addProperty(this.colorProperty);
    }

    addProperty(property: Property) {
        this.properties.set(property.name, property);
    }

    public startPolling(intervalMs: number) {
        super.startPolling(intervalMs);

        this.colorProperty.startPolling(intervalMs);
    }
}

class ColorModeProperty extends PollingProperty<'color' | 'temperature'> {
    constructor(device: Device, host: string, password: string) {
        super(device, 'colorMode', {
            '@type': 'ColorModeProperty',
            label: 'Color Mode',
            type: 'string',
            enum: [
                'color',
                'temperature',
            ],
            readOnly: true,
        },
            async () => {
                const response = await getStatus(host, password, 'Color');
                const result = await response.json();
                const color: string = result.Color;
                const rgb = color.substring(0, 6);

                if (rgb != '000000') {
                    this.update('color');
                } else {
                    this.update('temperature');
                }
            });
    }
}

export class ColorCtLight extends ColorLight {
    private colorTemperatureProperty: ColorTemperatureProperty;
    private colorModeProperty: ColorModeProperty;

    constructor(adapter: Adapter, id: string, host: string, password: string, manifest: any) {
        super(adapter, id, host, password, manifest);
        this['@context'] = 'https://iot.mozilla.org/schemas/';
        this['@type'] = ['Light'];
        this.name = id;

        this.colorTemperatureProperty = new ColorTemperatureProperty(this, host, password);
        this.addProperty(this.colorTemperatureProperty);

        this.colorModeProperty = new ColorModeProperty(this, host, password);
        this.addProperty(this.colorModeProperty);
    }

    addProperty(property: Property) {
        this.properties.set(property.name, property);
    }

    public startPolling(intervalMs: number) {
        super.startPolling(intervalMs);

        this.colorTemperatureProperty.startPolling(intervalMs);
        this.colorModeProperty.startPolling(intervalMs);
    }
}
