// @ts-check
'use strict';

const {
  pcmToWav,
  downsampleTo16k,
  calculateRms,
  createSyntheticAudioWav,
  AudioChunker
} = require('./audioPipeline.js');

const {
  STTService,
  StreamingDictationSession,
  STTProvider
} = require('./sttService.js');

const {
  ContextFormatter,
  AppCategory,
  SPOKEN_PUNCTUATION
} = require('./contextFormatter.js');

const {
  CommandClassifier,
  CommandType
} = require('./commandClassifier.js');

const {
  PersonalizationEngine,
  computeLevenshteinDistance,
  computeSimilarity
} = require('./personalization.js');

module.exports = {
  // Audio Pipeline
  pcmToWav,
  downsampleTo16k,
  calculateRms,
  createSyntheticAudioWav,
  AudioChunker,

  // STT Service
  STTService,
  StreamingDictationSession,
  STTProvider,

  // Context Formatter
  ContextFormatter,
  AppCategory,
  SPOKEN_PUNCTUATION,

  // Command Mode Classifier
  CommandClassifier,
  CommandType,

  // Personalization Engine
  PersonalizationEngine,
  computeLevenshteinDistance,
  computeSimilarity
};
