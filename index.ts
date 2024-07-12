import {
  EagleProfiler,
  EagleProfilerEnrollFeedback,
  checkWaveFile,
  getInt16Frames,
  EagleErrors,
  Eagle,
} from "@picovoice/eagle-node";

import * as fs from "fs";
import { WaveFile } from "wavefile";

const accessKey = "hello";
const eagleProfiler = new EagleProfiler(accessKey);
const FEEDBACK_TO_DESCRIPTIVE_MSG = {
  [EagleProfilerEnrollFeedback.NONE]: "Good audio",
  [EagleProfilerEnrollFeedback.AUDIO_TOO_SHORT]: "Insufficient audio length",
  [EagleProfilerEnrollFeedback.UNKNOWN_SPEAKER]: "Different speaker in audio",
  [EagleProfilerEnrollFeedback.NO_VOICE_FOUND]: "No voice found in audio",
  [EagleProfilerEnrollFeedback.QUALITY_ISSUE]:
    "Low audio quality due to bad microphone or environment",
};

const enrollAudioPaths = [
  "./My recording 1.wav",
  "./My recording 2.wav",
  "./My recording 3.wav",
];

let enrollPercentage = 0;
let audioData = [];
let scores: number[] = [];
const speakerLabels = [];
const profiles = [];

function printResults(scores: number[], labels: any) {
  let result = "\rscores -> ";

  let formattedResults = [];
  for (let i = 0; i < labels.length; i++) {
    formattedResults.push(`\`${labels[i]}\`: ${scores[i].toFixed(2)}`);
  }
  result += formattedResults.join(", ");

  process.stdout.write(`${result}\n`);
}

try {
  let feedbackMessage = "";

  for (let audioPath of enrollAudioPaths) {
    let waveBuffer = fs.readFileSync(audioPath);
    let inputWaveFile = new WaveFile(waveBuffer);

    if (!checkWaveFile(inputWaveFile, eagleProfiler.sampleRate)) {
      console.error(
        "Audio file did not meet requirements. Wave file must be 16KHz, 16-bit, linear PCM (mono).",
      );
      eagleProfiler?.release();
      process.exit();
    }

    let frames = getInt16Frames(inputWaveFile, eagleProfiler.frameLength);
    for (let frame of frames) {
      audioData.push(frame);
      if (
        audioData.length * eagleProfiler.frameLength >=
        eagleProfiler.minEnrollSamples
      ) {
        const enrollFrames = new Int16Array(
          audioData.length * eagleProfiler.frameLength,
        );
        for (let i = 0; i < audioData.length; i++) {
          enrollFrames.set(audioData[i], i * eagleProfiler.frameLength);
        }
        audioData = [];
        const { percentage, feedback } = eagleProfiler.enroll(enrollFrames);
        feedbackMessage = FEEDBACK_TO_DESCRIPTIVE_MSG[feedback];
        enrollPercentage = percentage;
      }
    }
  }

  console.log(enrollPercentage);

  if (enrollPercentage < 100) {
    console.error(
      `Failed to create speaker profile. Insufficient enrollment percentage: ${enrollPercentage.toFixed(2)}%. Please add more audio files for enrollment.`,
    );
    eagleProfiler?.release();
  } else if (enrollPercentage === 100) {
    const speakerProfile = eagleProfiler.export();
    const outputPath = "./speakerProfile.bin"; // Specify a valid file path
    fs.writeFileSync(outputPath, Buffer.from(speakerProfile));
    console.log(`Speaker profile is saved to ${outputPath}`);

    console.log("trying to recognize");
    const eagle = new Eagle(accessKey, speakerProfile);
    console.log(eagle);

    let recognizeWaveBuffer = fs.readFileSync("./aboutSpeechSdk.wav");
    let recognizeinputWaveFile = new WaveFile(recognizeWaveBuffer);

    let frames = getInt16Frames(recognizeinputWaveFile, eagle.frameLength);

    for (let profilePath of ["./aboutSpeechSdk.wav"]) {
      speakerLabels.push(profilePath);
      const buffer = fs.readFileSync(profilePath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
      profiles.push(arrayBuffer);
    }

    let totalScores = new Array(speakerLabels.length).fill(0);
    let frameCount = 0;

    for (let frame of frames) {
      scores = eagle.process(frame);
      for (let i = 0; i < scores.length; i++) {
        totalScores[i] += scores[i];
      }
      frameCount++;
    }

    for (let i = 0; i < totalScores.length; i++) {
      totalScores[i] /= frameCount;
    }

    printResults(totalScores, speakerLabels);
  }
} catch (e) {
  if (e instanceof EagleErrors.EagleActivationLimitReachedError) {
    console.error(`AccessKey '${accessKey}' has reached its processing limit.`);
  } else {
    console.error("Failed to enroll speaker:", e);
  }
}
