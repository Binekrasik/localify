import { ContextMenuManager } from '../interaction/ContextMenuManager'
import { LyricsManager } from '../lyrics/LyricsManager'
import { LoopManager } from '../player/LoopManager'
import { PlayerManager } from '../player/PlayerManager'
import { QueueManager } from '../queue/QueueManager'
import { RemoteManager } from '../remote/RemoteManager'
import { UpdateManager } from './UpdateManager'

export const Managers = {
    UpdateManager: new UpdateManager(),
    PlayerManager: new PlayerManager(),
    LyricsManager: new LyricsManager(),
    LoopManager: new LoopManager(),
    QueueManager: new QueueManager(),
    RemoteManager: new RemoteManager(),
    ContextMenuManager: new ContextMenuManager(),
}
