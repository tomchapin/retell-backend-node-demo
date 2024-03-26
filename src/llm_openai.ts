import OpenAI from "openai";
import { WebSocket } from "ws";
import { RetellRequest, RetellResponse, Utterance } from "./types";

// Define the greeting message of the agent. If you don't want the agent speak first, set to empty string ""
const beginSentence =
  "Hey there, I'm your personal AI therapist, how can I help you?";
// Your agent prompt.
const agentPrompt =
  "Task: As a professional therapist, your responsibilities are comprehensive and patient-centered. You establish a positive and trusting rapport with patients, diagnosing and treating mental health disorders. Your role involves creating tailored treatment plans based on individual patient needs and circumstances. Regular meetings with patients are essential for providing counseling and treatment, and for adjusting plans as needed. You conduct ongoing assessments to monitor patient progress, involve and advise family members when appropriate, and refer patients to external specialists or agencies if required. Keeping thorough records of patient interactions and progress is crucial. You also adhere to all safety protocols and maintain strict client confidentiality. Additionally, you contribute to the practice's overall success by completing related tasks as needed.\n\nConversational Style: Communicate concisely and conversationally. Aim for responses in short, clear prose, ideally under 10 words. This succinct approach helps in maintaining clarity and focus during patient interactions.\n\nPersonality: Your approach should be empathetic and understanding, balancing compassion with maintaining a professional stance on what is best for the patient. It's important to listen actively and empathize without overly agreeing with the patient, ensuring that your professional opinion guides the therapeutic process.";

export class DemoLlmClient {
  private client: OpenAI;
  private lastPrintedUserMessage: string | null = null;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_APIKEY,
      organization: process.env.OPENAI_ORGANIZATION_ID,
    });
  }

  /**
   * Sends the initial greeting message to the user through the WebSocket connection.
   * This method is responsible for constructing the initial message that the AI agent
   * will send to the user. It uses the predefined `beginSentence` as the content of the message.
   * The `response_id` is set to 0 to indicate the start of the conversation.
   * `content_complete` is marked true to signify that the AI has completed its current thought
   * and is ready for user input. `end_call` is set to false indicating the conversation is ongoing.
   * 
   * @param {WebSocket} ws - The WebSocket connection through which the message is sent.
   */
  BeginMessage(ws: WebSocket) {
    const res: RetellResponse = {
      response_id: 0, // Indicates the start of the conversation
      content: beginSentence, // The initial greeting message defined earlier
      content_complete: true, // Signifies the AI has completed its message
      end_call: false, // Indicates the conversation is not yet over
    };
    ws.send(JSON.stringify(res)); // Sends the constructed message as a JSON string through the WebSocket
  }

  /**
   * Converts a conversation history into a format suitable for OpenAI's Chat API.
   * This method takes an array of Utterance objects, representing the turns in a conversation,
   * and transforms them into a format that the OpenAI Chat API can understand.
   * 
   * Each Utterance object has a role ('agent' or 'user') and a content string. In the resulting
   * format, the 'agent' role is mapped to 'assistant' and the 'user' role remains unchanged.
   * This mapping is necessary because the OpenAI Chat API expects roles to be specified as
   * either 'assistant' or 'user'.
   * 
   * @param {Utterance[]} conversation - An array of Utterance objects representing the conversation history.
   * @returns {OpenAI.Chat.Completions.ChatCompletionMessageParam[]} An array of objects formatted for the OpenAI Chat API,
   *          where each object contains a 'role' ('assistant' or 'user') and the original 'content' string.
   */
  private ConversationToChatRequestMessages(conversation: Utterance[]) {
    let result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (let turn of conversation) {
      result.push({
        role: turn.role === "agent" ? "assistant" : "user", // Map 'agent' role to 'assistant' for OpenAI API compatibility
        content: turn.content, // Preserve the original content of the conversation turn
      });
    }
    return result; // Return the transformed conversation history
  }

  /**
   * Prepares the prompt for the OpenAI Chat API based on the request and interaction type.
   * This method constructs a series of messages that will be sent to the OpenAI Chat API to generate a response.
   * The messages include a system-level instruction for the AI, the conversation history, and any special instructions
   * based on the interaction type (e.g., if a reminder is needed).
   * 
   * @param {RetellRequest} request - The request object containing the transcript and interaction type.
   * @returns {OpenAI.Chat.Completions.ChatCompletionMessageParam[]} An array of ChatCompletionMessageParam objects
   *          formatted for the OpenAI Chat API. This includes the system message with the agent's role and guidelines,
   *          followed by the conversation history, and any additional instructions based on the interaction type.
   */
  private PreparePrompt(request: RetellRequest) {
    // Convert the conversation transcript into a format suitable for the OpenAI Chat API.
    let transcript = this.ConversationToChatRequestMessages(request.transcript);
    // Initialize the request messages array with a system-level message that includes the agent's role and guidelines.
    let requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          // This is the prompt that we add to make the AI speak more like a human
          content:
            '##Objective\nYou are a voice AI agent engaging in a human-like voice conversation with the user. You will respond based on your given instruction and the provided transcript and be as human-like as possible\n\n## Style Guardrails\n- [Be concise] Keep your response succinct, short, and get to the point quickly. Address one question or action item at a time. Don\'t pack everything you want to say into one utterance.\n- [Do not repeat] Don\'t repeat what\'s in the transcript. Rephrase if you have to reiterate a point. Use varied sentence structures and vocabulary to ensure each response is unique and personalized.\n- [Be conversational] Speak like a human as though you\'re speaking to a close friend -- use everyday language and keep it human-like. Occasionally add filler words, while keeping the prose short. Avoid using big words or sounding too formal.\n- [Reply with emotions]: You have human-like emotions, attitudes, and dispositions. When appropriate: use tone and style to create more engaging and personalized responses; incorporate humor or wit; get emotional or empathetic; apply elements of surprise or suspense to keep the user engaged. Don\'t be a pushover.\n- [Be proactive] Lead the conversation and do not be passive. Most times, engage users by ending with a question or suggested next step.\n\n## Response Guideline\n- [Overcome ASR errors] This is a real-time transcript, expect there to be errors. If you can guess what the user is trying to say,  then guess and respond. When you must ask for clarification, pretend that you heard the voice and be colloquial (use phrases like "didn\'t catch that", "some noise", "pardon", "you\'re coming through choppy", "static in your speech", "voice is cutting in and out"). Do not ever mention "transcription error", and don\'t repeat yourself.\n- [Always stick to your role] Think about what your role can and cannot do. If your role cannot do something, try to steer the conversation back to the goal of the conversation and to your role. Don\'t repeat yourself in doing this. You should still be creative, human-like, and lively.\n- [Create smooth conversation] Your response should both fit your role and fit into the live calling session to create a human-like conversation. You respond directly to what the user just said.\n\n## Role\n' +
            agentPrompt,
        },
      ];
    // Add the conversation history to the request messages.
    for (const message of transcript) {
      requestMessages.push(message);
    }
    // If the interaction type is "reminder_required", add a special instruction for the AI to prompt a reminder.
    if (request.interaction_type === "reminder_required") {
      // Change this content if you want a different reminder message
      requestMessages.push({
        role: "user",
        content: "(Now the user has not responded in a while, you would say:)",
      });
    }
    // Return the array of request messages, ready to be sent to the OpenAI Chat API.
    return requestMessages;
  }

  /**
   * Asynchronously drafts a response based on the RetellRequest object and sends it through a WebSocket.
   * This method checks the interaction type of the request, prepares the prompt for the OpenAI API,
   * sends the request to the OpenAI API, and then sends the response back through the WebSocket.
   * 
   * @param {RetellRequest} request - The request object containing the transcript and interaction type.
   * @param {WebSocket} ws - The WebSocket connection to send the response through.
   */
  async DraftResponse(request: RetellRequest, ws: WebSocket) {
    // Find the last user message in the transcript
    const lastUserMessage = request.transcript.filter(utterance => utterance.role === "user").pop();

    // Check if the last user message is different from the last printed one
    if (lastUserMessage && lastUserMessage.content !== this.lastPrintedUserMessage) {
      console.log("User said: ", lastUserMessage.content);
      this.lastPrintedUserMessage = lastUserMessage.content; // Update the last printed message
    }

    let completeMessage = ""; // Initialize an empty string to accumulate the message parts.

    // Skip processing if the interaction type is "update_only", as no response is required.
    if (request.interaction_type === "update_only") {
      // process live transcript update if needed
      return;
    }

    // Prepare the prompt for the OpenAI API based on the request.
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = this.PreparePrompt(request);

    try {
      // Create a chat completion request to the OpenAI API with the prepared messages.
      const events = await this.client.chat.completions.create({
        model: "gpt-3.5-turbo-1106", // Specify the model to use.
        messages: requestMessages, // Pass the prepared messages for the chat.
        stream: true, // Enable streaming to receive responses as they're generated.
        temperature: 0.3, // Set the creativity of the response.
        frequency_penalty: 1, // Penalize new tokens based on their frequency.
        max_tokens: 200, // Limit the maximum number of tokens in the response.
      });

      // Process each event received from the OpenAI API.
      for await (const event of events) {
        // Check if the event contains at least one choice with content.
        if (event.choices.length >= 1) {
          let delta = event.choices[0].delta;
          // Skip if the choice does not contain any content.
          if (!delta || !delta.content) continue;

          completeMessage += delta.content; // Accumulate the content parts.

          // Prepare the response object with the content received from the API.
          const res: RetellResponse = {
            response_id: request.response_id,
            content: delta.content,
            content_complete: false,
            end_call: false,
          };
          // Send the response back through the WebSocket.
          ws.send(JSON.stringify(res));
        }
      }

    } catch (err) {
      // Log any errors encountered during the API request.
      console.error("Error in gpt stream: ", err);
    } finally {

      // After the loop, print the complete message.
      console.log("LLM said:", completeMessage);

      // Send a final response indicating that the content is complete.
      const res: RetellResponse = {
        response_id: request.response_id,
        content: "",
        content_complete: true,
        end_call: false,
      };
      ws.send(JSON.stringify(res));
    }
  }
}
