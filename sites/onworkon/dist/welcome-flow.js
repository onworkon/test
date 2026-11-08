import { normalizeName, validName } from './name-validation.js';
import { resolveInvitationCode } from './page-routes.js';

const steps = ['hello', 'name', 'welcome', 'invitation', 'code', 'workspace'];

export class WelcomeFlow {
  #index = 0;
  #name = '';
  #nameReady = false;
  #saving = false;
  #destination = null;

  get state() {
    const step = steps[this.#index];
    const messages = {
      hello: 'Hello!',
      name: 'What should I call you? :',
      welcome: 'Welcome to my space ' + this.#name,
      invitation: 'Were you invited?',
      code: 'Please provide the code. :',
      workspace: 'My space',
    };
    return { step, text: messages[step], name: this.#name, nameReady: this.#nameReady, saving: this.#saving, destination: this.#destination };
  }

  completeName(value) {
    if (this.state.step !== 'name' || this.#saving) return false;
    this.#nameReady = validName(value);
    this.#name = this.#nameReady ? normalizeName(value) : '';
    return this.#nameReady;
  }

  submitCode(value) {
    if (this.state.step !== 'code' || typeof value !== 'string') return false;
    const destination = resolveInvitationCode(value);
    if (!destination) return false;
    this.#destination = destination;
    this.#index += 1;
    return true;
  }

  async next(saveName) {
    if (this.#saving || ['code', 'workspace'].includes(this.state.step)) return false;
    if (this.state.step === 'name') {
      if (!this.#nameReady) return false;
      if (typeof saveName !== 'function') throw new Error('Name storage is required.');
      this.#saving = true;
      try {
        await saveName(this.#name);
      } finally {
        this.#saving = false;
      }
    }
    this.#index += 1;
    return true;
  }
}
