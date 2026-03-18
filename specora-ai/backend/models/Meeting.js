const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Meeting title is required'],
    trim: true,
  },
  audioUrl: {
    type: String,
    default: '',
  },
  transcript: {
    type: String,
    default: '',
  },
  requirements: {
    type: [String],
    default: [],
  },
  userStories: {
    type: [String],
    default: [],
  },
  apiEndpoints: {
    type: [
      {
        method: String,
        path: String,
        description: String,
      },
    ],
    default: [],
  },
  dbTables: {
    type: [
      {
        table: String,
        columns: [String],
      },
    ],
    default: [],
  },
  architecture: {
    type: String,
    default: '',
  },
  srs: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['created', 'uploading', 'transcribing', 'analyzing', 'completed', 'error'],
    default: 'created',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Meeting', meetingSchema);
