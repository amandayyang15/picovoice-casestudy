#
#    Copyright 2023 Picovoice Inc.
#
#    You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
#    file accompanying this source.
#
#    Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
#    an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
#    specific language governing permissions and limitations under the License.
#

import argparse
import os
import struct
import sys
import unittest
import wave
from time import perf_counter

from _koala import Koala
from _util import default_library_path, default_model_path


class KoalaPerformanceTestCase(unittest.TestCase):
    AUDIO_PATH = os.path.join(os.path.dirname(__file__), '../../resources/audio_samples/test.wav')

    access_key: str
    num_test_iterations: int
    proc_performance_threshold_sec: float

    def test_performance_proc(self) -> None:
        with wave.open(self.AUDIO_PATH, 'rb') as f:
            buffer = f.readframes(f.getnframes())
            pcm = struct.unpack('%dh' % (len(buffer) / struct.calcsize('h')), buffer)

        koala = Koala(
            access_key=self.access_key,
            library_path=default_library_path('../..'),
            model_path=default_model_path('../..'))

        num_frames = len(pcm) // koala.frame_length

        perf_results = list()
        for i in range(self.num_test_iterations + 1):
            start = perf_counter()
            for j in range(num_frames):
                frame = pcm[j * koala.frame_length:(j + 1) * koala.frame_length]
                koala.process(frame)

            if i > 0:
                perf_results.append(perf_counter() - start)

        koala.delete()

        avg_perf = sum(perf_results) / self.num_test_iterations
        print("Average proc performance: %s seconds" % avg_perf)
        self.assertLess(avg_perf, self.proc_performance_threshold_sec)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--access-key', required=True)
    parser.add_argument('--num-test-iterations', type=int, required=True)
    parser.add_argument('--proc-performance-threshold-sec', type=float, required=True)
    args = parser.parse_args()

    KoalaPerformanceTestCase.access_key = args.access_key
    KoalaPerformanceTestCase.num_test_iterations = args.num_test_iterations
    KoalaPerformanceTestCase.proc_performance_threshold_sec = args.proc_performance_threshold_sec

    unittest.main(argv=sys.argv[:1])
