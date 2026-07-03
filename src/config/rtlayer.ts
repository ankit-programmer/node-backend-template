import RTLayer from 'rtlayer-node';
import { requireEnv } from './env';

let instance: RTLayer | undefined;

export default (): RTLayer => {
    instance ??= new RTLayer(requireEnv('RTLAYER_API_KEY'));
    return instance;
};
