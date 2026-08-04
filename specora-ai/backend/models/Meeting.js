const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  // SECURITY: every meeting is owned by exactly one user. All queries must be
  // scoped by this field so users cannot reach each other's meetings.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Meeting owner is required'],
    index: true,
  },
  title: {
    type: String,
    required: [true, 'Meeting title is required'],
    trim: true,
  },
  audioUrl: {
    type: String,
    default: '',
  },
  audioPath: {
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
    enum: [
      'created',
      'uploading',
      'transcribing',
      'transcribed',
      'analyzing',
      'completed',
      'error',
    ],
    default: 'created',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Meeting', meetingSchema);
