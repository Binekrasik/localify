import { ContextMenuManager } from '../interaction/ContextMenuManager'
import { LyricsManager } from '../lyrics/LyricsManager'
import { PlayerManager } from '../player/PlayerManager'
import { QueueManager } from '../queue/QueueManager'
import { RemoteManager } from '../remote/RemoteManager'
import { UpdateManager } from './UpdateManager'

export const Managers = {
    UpdateManager: new UpdateManager(),
    PlayerManager: new PlayerManager(),
    LyricsManager: new LyricsManager(),
    QueueManager: new QueueManager(),
    RemoteManager: new RemoteManager(),
    ContextMenuManager: new ContextMenuManager(),
}
