import RTLayer from 'rtlayer-node';
import { requireEnv } from './env';

// Unlike mongo/rabbitmq there is no connectionRegistry here: the RTLayer client is
// a stateless API wrapper, so a single lazy module-level instance is all we need.
let instance: RTLayer | undefined;

export function getRtLayer(): RTLayer {
    instance ??= new RTLayer(requireEnv('RTLAYER_API_KEY'));
    return instance;
}
