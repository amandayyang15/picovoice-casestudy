/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import PvWorker from 'web-worker:./koala_worker_handler.ts';

import {
  KoalaModel,
  KoalaOptions,
  KoalaWorkerInitResponse,
  KoalaWorkerProcessResponse,
  KoalaWorkerReleaseResponse,
  KoalaWorkerResetResponse,
  PvStatus,
} from './types';
import { loadModel } from '@picovoice/web-utils';
import { pvStatusToException } from './koala_errors';

export class KoalaWorker {
  private readonly _worker: Worker;
  private readonly _version: string;
  private readonly _frameLength: number;
  private readonly _sampleRate: number;
  private readonly _delaySample: number;
  private static _sdk: string = 'web';

  private static _wasm: string;
  private static _wasmSimd: string;

  private constructor(
    worker: Worker,
    version: string,
    frameLength: number,
    sampleRate: number,
    delaySample: number
  ) {
    this._worker = worker;
    this._version = version;
    this._frameLength = frameLength;
    this._sampleRate = sampleRate;
    this._delaySample = delaySample;
  }

  /**
   * Delay in samples. If the input and output of consecutive calls to `.process()` are viewed as two contiguous
   * streams of audio data, this delay specifies the time shift between the input and output stream.
   */
  get delaySample(): number {
    return this._delaySample;
  }

  /**
   * Get Koala engine version.
   */
  get version(): string {
    return this._version;
  }

  /**
   * Get Koala frame length.
   */
  get frameLength(): number {
    return this._frameLength;
  }

  /**
   * Get sample rate.
   */
  get sampleRate(): number {
    return this._sampleRate;
  }

  /**
   * Get Koala worker instance.
   */
  get worker(): Worker {
    return this._worker;
  }

  /**
   * Set base64 wasm file.
   * @param wasm Base64'd wasm file to use to initialize wasm.
   */
  public static setWasm(wasm: string): void {
    if (this._wasm === undefined) {
      this._wasm = wasm;
    }
  }

  /**
   * Set base64 wasm file with SIMD feature.
   * @param wasmSimd Base64'd wasm file to use to initialize wasm.
   */
  public static setWasmSimd(wasmSimd: string): void {
    if (this._wasmSimd === undefined) {
      this._wasmSimd = wasmSimd;
    }
  }

  public static setSdk(sdk: string): void {
    KoalaWorker._sdk = sdk;
  }

  /**
   * Creates an instance of the Picovoice Koala Noise Suppression Engine.
   * Behind the scenes, it requires the WebAssembly code to load and initialize before
   * it can create an instance.
   *
   * @param accessKey AccessKey obtained from Picovoice Console (https://console.picovoice.ai/)
   * @param processCallback User-defined callback to run after receiving enhanced pcm result.
   * The output is not directly the enhanced version of the input PCM, but corresponds to samples that were given in
   * previous calls to `.process()`. The delay in samples between the start time of the input frame and the start
   * time of the output frame can be attained from `.delaySample`.
   * @param model Koala model options.
   * @param model.base64 The model in base64 string to initialize Koala.
   * @param model.publicPath The model path relative to the public directory.
   * @param model.customWritePath Custom path to save the model in storage.
   * Set to a different name to use multiple models across `koala` instances.
   * @param model.forceWrite Flag to overwrite the model in storage even if it exists.
   * @param model.version Version of the model file. Increment to update the model file in storage.
   * @param options Optional configuration arguments.
   * @param options.processErrorCallback User-defined callback invoked if any error happens
   * while processing the audio stream. Its only input argument is the error message.
   *
   * @returns An instance of the Koala engine.
   */
  public static async create(
    accessKey: string,
    processCallback: (enhancedPcm: Int16Array) => void,
    model: KoalaModel,
    options: KoalaOptions = {}
  ): Promise<KoalaWorker> {
    const { processErrorCallback, ...workerOptions } = options;

    const customWritePath = model.customWritePath
      ? model.customWritePath
      : 'koala_model';
    const modelPath = await loadModel({ ...model, customWritePath });

    const worker = new PvWorker();
    const returnPromise: Promise<KoalaWorker> = new Promise(
      (resolve, reject) => {
        // @ts-ignore - block from GC
        this.worker = worker;
        worker.onmessage = (
          event: MessageEvent<KoalaWorkerInitResponse>
        ): void => {
          switch (event.data.command) {
            case 'ok':
              worker.onmessage = (
                ev: MessageEvent<
                  KoalaWorkerProcessResponse | KoalaWorkerResetResponse
                >
              ): void => {
                switch (ev.data.command) {
                  case 'ok-process':
                    processCallback(ev.data.enhancedPcm);
                    break;
                  case 'ok-reset':
                    break;
                  case 'failed':
                  case 'error':
                    {
                      const error = pvStatusToException(
                        ev.data.status,
                        ev.data.shortMessage,
                        ev.data.messageStack
                      );
                      if (processErrorCallback) {
                        processErrorCallback(error);
                      } else {
                        // eslint-disable-next-line no-console
                        console.error(error);
                      }
                    }
                    break;
                  default:
                    // @ts-ignore
                    processErrorCallback(
                      pvStatusToException(
                        PvStatus.RUNTIME_ERROR,
                        `Unrecognized command: ${event.data.command}`
                      )
                    );
                }
              };
              resolve(
                new KoalaWorker(
                  worker,
                  event.data.version,
                  event.data.frameLength,
                  event.data.sampleRate,
                  event.data.delaySample
                )
              );
              break;
            case 'failed':
            case 'error':
              reject(
                pvStatusToException(
                  event.data.status,
                  event.data.shortMessage,
                  event.data.messageStack
                )
              );
              break;
            default:
              reject(
                pvStatusToException(
                  PvStatus.RUNTIME_ERROR,
                  // @ts-ignore
                  `Unrecognized command: ${event.data.command}`
                )
              );
          }
        };
      }
    );

    worker.postMessage({
      command: 'init',
      accessKey: accessKey,
      modelPath: modelPath,
      options: workerOptions,
      wasm: this._wasm,
      wasmSimd: this._wasmSimd,
      sdk: this._sdk,
    });

    return returnPromise;
  }

  /**
   * Processes a frame of audio in a worker.
   * The result will be supplied with the callback provided when initializing the worker either
   * by 'fromBase64' or 'fromPublicDirectory'.
   * Can also send a message directly using 'this.worker.postMessage({command: "process", pcm: [...]})'.
   *
   * @param pcm A frame of audio sample.
   */
  public process(pcm: Int16Array): void {
    this._worker.postMessage({
      command: 'process',
      inputFrame: pcm,
    });
  }

  /**
   * Resets Koala into a state as if it had just been newly created.
   * Call this function in between calls to `process` that do not provide consecutive frames of audio.
   */
  public async reset(): Promise<void> {
    this._worker.postMessage({
      command: 'reset',
    });
  }

  /**
   * Releases resources acquired by WebAssembly module.
   */
  public release(): Promise<void> {
    const returnPromise: Promise<void> = new Promise((resolve, reject) => {
      this._worker.onmessage = (
        event: MessageEvent<KoalaWorkerReleaseResponse>
      ): void => {
        switch (event.data.command) {
          case 'ok':
            resolve();
            break;
          case 'failed':
          case 'error':
            reject(
              pvStatusToException(
                event.data.status,
                event.data.shortMessage,
                event.data.messageStack
              )
            );
            break;
          default:
            reject(
              pvStatusToException(
                PvStatus.RUNTIME_ERROR,
                // @ts-ignore
                `Unrecognized command: ${event.data.command}`
              )
            );
        }
      };
    });

    this._worker.postMessage({
      command: 'release',
    });

    return returnPromise;
  }

  /**
   * Terminates the active worker. Stops all requests being handled by worker.
   */
  public terminate(): void {
    this._worker.terminate();
  }
}
