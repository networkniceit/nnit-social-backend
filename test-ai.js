const axios = require("axios");

// Test OpenAI
async function testOpenAI() {
  try {
    const response = await axios.post(
      "http://localhost:4000/api/ai/generate-caption",
      {
        topic: "test post",
        tone: "professional",
        clientId: "test123",
        includeEmojis: true,
        includeHashtags: true
      }
    );
    console.log("✅ OpenAI works:", response.data);
  } catch (error) {
    console.log("❌ OpenAI failed:", error.response?.data || error.message);
  }
}

testOpenAI();