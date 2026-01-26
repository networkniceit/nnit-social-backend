const { OpenAI } = require("openai");
require("dotenv").config();

async function testOpenAIDetailed() {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    console.log("🔍 Testing OpenAI API...");
    console.log("API Key length:", process.env.OPENAI_API_KEY.length);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ 
        role: "user", 
        content: "Write a short social media post about AI"
      }],
      max_tokens: 100
    });
    
    console.log("✅ SUCCESS!");
    console.log(completion.choices[0].message.content);
    
  } catch (error) {
    console.log("❌ DETAILED ERROR:");
    console.log("Status:", error.status);
    console.log("Message:", error.message);
    console.log("Type:", error.type);
    console.log("Code:", error.code);
    console.log("Full error:", JSON.stringify(error, null, 2));
  }
}

testOpenAIDetailed();