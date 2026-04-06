import type GlyphConfig from '../config/glyph.config';
import BaseCommand from './base.command';

export default class ReloadConfig extends BaseCommand {
    constructor(private readonly glyphConfig: GlyphConfig) {
        super();
    }

    public id: string = 'glyph.reload';

    public action = () => {
        this.glyphConfig.reloadConfig();
    };
}
