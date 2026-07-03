import { ContextMenuManager } from '../interaction/ContextMenuManager'
import { LoadingBar } from '../loading/LoadingBar'
import { LyricsManager } from '../lyrics/LyricsManager'
import { LoopManager } from '../player/LoopManager'
import { PlayerManager } from '../player/PlayerManager'
import { QueueManager } from '../queue/QueueManager'
import { RemoteManager } from '../remote/RemoteManager'
import { UpdateManager } from './UpdateManager'
import { EventBus } from './EventBus'

export const bus = new EventBus()
export const updateManager = new UpdateManager()

export const Managers = {
    UpdateManager: updateManager,
    PlayerManager: new PlayerManager(),
    LyricsManager: new LyricsManager(),
    LoopManager: new LoopManager(),
    QueueManager: new QueueManager(),
    RemoteManager: new RemoteManager(),
    ContextMenuManager: new ContextMenuManager(),
    LoadingBar: new LoadingBar(),
}
