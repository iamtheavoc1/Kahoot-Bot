// Real payloads, captured from Kahoot.
//
// The live-game payloads come from the community reverse engineering in
//   github.com/manhtruong03/real-time-quiz
//     docs/data_structures/phase2_ws_question_detail.md
//     src/lib/types/websocket-protocol.ts
//
// The challenge payload was fetched from
//   https://kahoot.it/rest/challenges/pin/00112233
//
// Nothing here is invented. If the bot breaks against these, it breaks
// against Kahoot.

export const QUIZ_FOUR_TEXT = {
  gameBlockIndex: 5,
  totalGameBlockCount: 15,
  title: "Which of the below is one thing quantum computers <b>can't</b> do?",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/37defd0-4652-4c2f-a5a8-f0c5f8f28c2c",
  media: [],
  type: "quiz",
  timeRemaining: 29998,
  timeAvailable: 30000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  pointsMultiplier: 1,
  numberOfChoices: 4,
  choices: [
    { answer: "Help us search for Earth-like planets" },
    { answer: "Break mainstream cryptosystems used for data security" },
    { answer: "Potentially cure Alzheimer’s disease" },
    { answer: "Replace world leaders" },
  ],
  questionRestricted: false,
  getReadyTimeAvailable: 6600,
  getReadyTimeRemaining: 6600,
  questionIndex: 5,
  gameBlockType: "quiz",
};

export const QUIZ_TRUE_FALSE = {
  gameBlockIndex: 3,
  totalGameBlockCount: 15,
  title: "<b>True or false </b>-<b> </b>The Beyond Meat fried chicken at a KFC in Atlanta, GA, sold out 5 hours after launch.",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/290addae-7ff9-4cff-804f-d9354f7e46ac",
  media: [],
  type: "quiz",
  timeRemaining: -823909,
  timeAvailable: 20000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  pointsMultiplier: 1,
  numberOfChoices: 2,
  choices: [{ answer: "True" }, { answer: "False" }],
  questionRestricted: false,
  getReadyTimeAvailable: 6600,
  getReadyTimeRemaining: 6600,
  questionIndex: 3,
  gameBlockType: "quiz",
};

export const QUIZ_IMAGE_CHOICES = {
  gameBlockIndex: 7,
  totalGameBlockCount: 15,
  title: "Find the flag of <b>Switzerland.</b>",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/53154f05-eab7-4c56-8772-866b131ee2c4",
  media: [
    {
      type: "background_image",
      zIndex: -1,
      isColorOnly: false,
      id: "781d8f42-b21a-4579-be37-ab59f968c09d",
      altText: "Illuminated Buildings And City Street At Night",
      contentType: "image/jpeg",
      width: 2119,
      height: 1415,
    },
  ],
  type: "quiz",
  timeRemaining: 19998,
  timeAvailable: 20000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  numberOfChoices: 4,
  choices: [
    { image: { id: "588f9aff-82f1-473d-ac0b-560511c71fe5", altText: "swiss flag", contentType: "image/jpeg", width: 4000, height: 2400 } },
    { image: { id: "72f30900-7645-4eaa-8b41-353f41992716", altText: "austrian flag", contentType: "image/jpeg", width: 4000, height: 2400 } },
    { image: { id: "b9f8a9fb-4002-437e-9aae-097e1a3a776e", altText: "Graphic of the blue and yellow Swedish national flag", contentType: "image/jpeg", width: 4000, height: 2400 } },
    { image: { id: "999be536-7566-445b-a695-ec203049382f", altText: "Flat Flag of Albania", contentType: "image/jpeg", width: 4000, height: 2400 } },
  ],
};

export const JUMBLE = {
  gameBlockIndex: 1,
  totalGameBlockCount: 15,
  title: "Let's start with science! Place these space events in order:",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/f3a2ced4-2a00-4125-b791-9e5621faa001",
  media: [],
  type: "jumble",
  timeRemaining: 0,
  timeAvailable: 60000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  pointsMultiplier: 1,
  numberOfChoices: 4,
  choices: [
    { answer: "NASA announces International Space Station will open to tourists" },
    { answer: "Food grown in space eaten" },
    { answer: "All female space walk" },
    { answer: "Soft landing on the far side of the moon" },
  ],
  questionRestricted: false,
  getReadyTimeAvailable: 4100,
  getReadyTimeRemaining: 4100,
  questionIndex: 1,
  gameBlockType: "jumble",
};

export const OPEN_ENDED = {
  gameBlockIndex: 14,
  totalGameBlockCount: 15,
  title: "Final question and double points! What was Pantone's color of 2019?",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/754dc179-c090-4a8d-8404-0e705d813821",
  media: [],
  type: "open_ended",
  timeRemaining: 29998,
  timeAvailable: 30000,
  getReadyTimeAvailable: 6600,
  getReadyTimeRemaining: 6600,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  pointsMultiplier: 2,
  questionIndex: 14,
  gameBlockType: "open_ended",
};

export const SURVEY = {
  gameBlockIndex: 10,
  totalGameBlockCount: 15,
  title: "What's your top movie choice from these all-time classics?",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/76df82c1-b762-496c-8e45-a4c5aff89f63",
  media: [],
  type: "survey",
  timeRemaining: 19994,
  timeAvailable: 20000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  numberOfChoices: 4,
  choices: [
    { answer: "The Godfather" },
    { answer: "Pulp Fiction" },
    { answer: "Star Wars" },
    { answer: "Forrest Gump" },
  ],
  questionIndex: 10,
  gameBlockType: "survey",
};

export const CONTENT = {
  gameBlockIndex: 0,
  totalGameBlockCount: 15,
  title: "Get ready to wrap up 2019 and enter a new decade!",
  video: { startTime: 0, endTime: 0, service: "youtube", fullUrl: "" },
  image: "https://media.kahoot.it/16cb820f-c510-49ba-8a97-ca121c828a87",
  media: [],
  type: "content",
  description: "Let's take a tour of everything exciting that happened in 2019, and test how much you paid attention! Get ready in 3...2...1...",
  getReadyTimeAvailable: 0,
  getReadyTimeRemaining: 0,
  questionIndex: 0,
  gameBlockType: "content",
};

// A challenge question, straight from the Kahoot REST API. Challenge pins are
// the only case where the correct flag is sent to the client.
export const CHALLENGE_QUIZ = {
  questionFormat: 0,
  media: [],
  question: "จิตวิทยา Psychology มีรากศัพท์มาจากภาษาอะไร?",
  time: 20000,
  pointsMultiplier: 1,
  choices: [
    { answer: "โรมัน", correct: false },
    { answer: "กรีก", correct: true },
    { answer: "โบราณ", correct: false },
    { answer: "ไทย", correct: false },
  ],
  type: "quiz",
  questionIndex: 0,
  timeLeft: 5,
  gameBlockType: "quiz",
  gameBlockLayout: "CLASSIC",
  quizQuestionAnswers: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  index: 0,
  timeAvailable: 20000,
};

/* ------------------------------------------------------------------ live */

// A live game where the host has "Show questions & answers on players'
// devices" switched OFF. Captured by the owner.
//
// There is no title and no choices. The question is simply not sent.
//
//   PROBE text field: null
//   PROBE choices field: []
export const LIVE_NO_TEXT = {
  gameBlockIndex: 1,
  totalGameBlockCount: 20,
  layout: "CLASSIC",
  extensiveMode: false,
  type: "quiz",
  timeRemaining: 19994,
  timeAvailable: 20000,
  numberOfAnswersAllowed: 1,
  currentQuestionAnswerCount: 0,
  numberOfChoices: 4,
};

// A live QuizStart. `firstGameBlockData` is the first question of the quiz,
// and it is complete: the text, the options, and the correct flags.
export const LIVE_QUIZ_START = {
  quizType: "classic",
  gameBlockCount: 20,
  quizQuestionAnswers: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  firstGameBlockData: {
    type: "quiz",
    questionIndex: 0,
    title: "Which planet is closest to the Sun?",
    numberOfChoices: 4,
    numberOfAnswersAllowed: 1,
    choices: [
      { answer: "Mercury", correct: true },
      { answer: "Venus", correct: false },
      { answer: "Earth", correct: false },
      { answer: "Mars", correct: false },
    ],
  },
};

// A live QuestionReady with the setting off. `nextGameBlockData` is there
// but stubbed: empty choices, no text, just the image metadata.
export const LIVE_READY_STUBBED = {
  questionIndex: 1,
  gameBlockType: "quiz",
  gameBlockLayout: "CLASSIC",
  quizQuestionAnswers: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  timeLeft: 5,
  nextGameBlockData: {
    type: "quiz",
    media: [],
    layout: "TOP_IMAGE",
    imageMetadata: {
      id: "ae716b40-76ad-40e4-8259-15cccebdb4b9",
      altText: "https://images-cdn.kahoot.it/ae716b40-76ad-40e4-8259-15cccebdb4b9?auto=webp",
      contentType: "image/jpeg",
      width: 640,
      height: 427,
    },
    choices: [{}, {}, {}, {}],
  },
};

// A live QuestionReady with the setting on: the next question comes whole.
export const LIVE_READY_COMPLETE = {
  questionIndex: 1,
  gameBlockType: "quiz",
  gameBlockLayout: "CLASSIC",
  quizQuestionAnswers: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  timeLeft: 5,
  nextGameBlockData: {
    type: "quiz",
    questionIndex: 1,
    title: "Which planet is second from the Sun?",
    numberOfChoices: 4,
    numberOfAnswersAllowed: 1,
    choices: [{ answer: "Mercury" }, { answer: "Venus" }, { answer: "Earth" }, { answer: "Mars" }],
  },
};

// The game settings a live join returns. `provideControllerExtensiveData`
// says whether the server was willing to send the question text.
export const LIVE_SETTINGS = {
  gameOptions: {
    provideControllerExtensiveData: false,
    reactions: true,
    questionTimer: true,
    shuffleQuestions: false,
  },
  gameMode: "classic",
  questionCount: 20,
};
