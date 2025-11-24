import sqs from '../../safeQuerySelector';
import { Manager } from '../manager/Manager';

export class PlayerManager extends Manager {
    static state = {
        isPlaying: false,
        currentTime: 0,
        duration: 0,

        audioElement: sqs('#audioPlayer') as HTMLAudioElement,
    }

    Initialize() {

    }

    LoadAudioFile (file: File) {

    }
}