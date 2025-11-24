import { LyricsManager } from '../lyrics/LyricsManager';
import { PlayerManager } from '../player/PlayerManager';
import { UpdateManager } from './UpdateManager';

export const Managers = {
    UpdateManager: new UpdateManager(),
    PlayerManager: new PlayerManager(),
    LyricsManager: new LyricsManager(),
}