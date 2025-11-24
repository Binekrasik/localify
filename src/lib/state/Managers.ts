import { LyricsManager } from '../lyrics/LyricsManager';
import { PlayerManager } from '../player/PlayerManager';

export const Managers = {
    PlayerManager: new PlayerManager(),
    LyricsManager: new LyricsManager(),
}