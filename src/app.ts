import { Managers } from './lib/state/Managers'
import { preloadFileParser } from './lib/workers/FileParserPool'

preloadFileParser()

Managers.LyricsManager.Initialize()
Managers.PlayerManager.Initialize()
Managers.QueueManager.Initialize()
Managers.ContextMenuManager.Initialize()
Managers.UpdateManager.Initialize()
Managers.LoadingBarManager.Initialize()
Managers.PresenceManager.Initialize()
