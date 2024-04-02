import { Request, Response } from "express";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import expressWs from "express-ws";
import twilio, { Twilio } from "twilio";
import { RetellClient } from "retell-sdk";
import {
  AudioWebsocketProtocol,
  AudioEncoding,
} from "retell-sdk/models/components";

export class TwilioClient {
  private twilio: Twilio;
  private retellClient: RetellClient;

  constructor() {
    this.twilio = twilio(
      process.env.TWILIO_ACCOUNT_ID,
      process.env.TWILIO_AUTH_TOKEN,
    );
    this.retellClient = new RetellClient({
      apiKey: process.env.RETELL_API_KEY,
    });
  }

  // Create a new phone number and route it to use this server.
  CreatePhoneNumber = async (areaCode: number, agentId: string) => {
    try {
      const localNumber = await this.twilio
        .availablePhoneNumbers("US")
        .local.list({ areaCode: areaCode, limit: 1 });
      if (!localNumber || localNumber[0] == null)
        throw "No phone numbers of this area code.";

      const phoneNumberObject = await this.twilio.incomingPhoneNumbers.create({
        phoneNumber: localNumber[0].phoneNumber,
        voiceUrl: `${process.env.NGROK_IP_ADDRESS}/twilio-voice-webhook/${agentId}`,
      });
      console.log("Getting phone number:", phoneNumberObject);
      return phoneNumberObject;
    } catch (err) {
      console.error("Create phone number API: ", err);
    }
  };

  // Update this phone number to use provided agent id. Also updates voice URL address.
  RegisterPhoneAgent = async (number: string, agentId: string) => {
    try {
      const phoneNumberObjects = await this.twilio.incomingPhoneNumbers.list();
      const webhookUrl = `${process.env.NGROK_IP_ADDRESS}/twilio-voice-webhook/${agentId}`;
      let numberSid;

      for (const phoneNumberObject of phoneNumberObjects) {
        if (phoneNumberObject.phoneNumber === number) {
          numberSid = phoneNumberObject.sid;
        }
      }
      if (numberSid == null) {
        return console.error(
          "Unable to locate this number in your Twilio account, is the number you used in BCP 47 format?",
        );
      }

      await this.twilio.incomingPhoneNumbers(numberSid).update({
        voiceUrl: webhookUrl,
        voiceMethod: "POST",
      });
      console.log(
        `Successfully updated the phone number ${number} (SID: ${numberSid}) to use agent ID: ${agentId}. The voice URL is now: ${webhookUrl}`,
      );
    } catch (error: any) {
      console.error("failer to retrieve caller information: ", error);
    }
  };

  // Release a phone number
  DeletePhoneNumber = async (phoneNumberKey: string) => {
    await this.twilio.incomingPhoneNumbers(phoneNumberKey).remove();
  };

  // Create an outbound call
  CreatePhoneCall = async (
    fromNumber: string,
    toNumber: string,
    agentId: string,
  ) => {
    try {
      await this.twilio.calls.create({
        machineDetection: "Enable", // detects if the other party is IVR
        machineDetectionTimeout: 8,
        asyncAmd: "true", // call webhook when determined whether it is machine
        asyncAmdStatusCallback: `${process.env.NGROK_IP_ADDRESS}/twilio-voice-webhook/${agentId}`, // Webhook url for machine detection
        url: `${process.env.NGROK_IP_ADDRESS}/twilio-voice-webhook/${agentId}`, // Webhook url for registering call
        to: toNumber,
        from: fromNumber,
      });
      console.log(`Call from: ${fromNumber} to: ${toNumber}`);
    } catch (error: any) {
      console.error("failer to retrieve caller information: ", error);
    }
  };

  // Use LLM function calling or some kind of parsing to determine when to let AI end the call
  EndCall = async (sid: string) => {
    try {
      const call = await this.twilio.calls(sid).update({
        twiml: "<Response><Hangup></Hangup></Response>",
      });
      console.log("End phone call: ", call);
    } catch (error) {
      console.error("Twilio end error: ", error);
    }
  };

  // Use LLM function calling or some kind of parsing to determine when to transfer away this call
  TransferCall = async (sid: string, transferTo: string) => {
    try {
      const call = await this.twilio.calls(sid).update({
        twiml: `<Response><Dial>${transferTo}</Dial></Response>`,
      });
      console.log("Transfer phone call: ", call);
    } catch (error) {
      console.error("Twilio transfer error: ", error);
    }
  };

  // Twilio voice webhook
  ListenTwilioVoiceWebhook = (app: expressWs.Application) => {
    app.post(
      "/twilio-voice-webhook/:agent_id",
      async (req: Request, res: Response) => {
        console.log(req.body);
        console.log(req.params);
        const agentId = req.params.agent_id;
        const answeredBy = req.body.AnsweredBy;
        try {
          // Respond with TwiML to hang up the call if its machine
          if (answeredBy && answeredBy === "machine_start") {
            this.EndCall(req.body.CallSid);
            return;
          } else if (answeredBy) {
            return;
          }

          // Initiating a call registration with Retell AI
          // agentId: Unique identifier for the agent handling the call
          // audioWebsocketProtocol: Specifies the protocol for the audio websocket connection.
          // Here, it's set to Twilio's protocol, indicating the audio data will be formatted according to Twilio's specifications.
          // audioEncoding: The audio encoding format. Mulaw is a common telephony encoding that's used here.
          // sampleRate: The sample rate of the audio in Hz. 8000 Hz is a common sample rate for telephone audio.
          // Additional options that can be toggled on or off by uncommenting:
          // opt_out_sensitive_data_storage: Boolean to disable transcripts and recordings storage for enhanced privacy.
          // llm_websocket_url: The URL for establishing LLM websocket for getting response, usually your server.
          // agent_name: The name of the agent, used for your own reference.
          // voice_id: Unique voice id used for the agent.
          // voice_temperature: Controls how stable the voice is, ranging from [0,2].
          // voice_speed: Controls the speed of the voice, ranging from [0.5,2].
          // responsiveness: Controls how responsive the agent is, ranging from [0,1].
          // enable_backchannel: Boolean to control whether the agent would backchannel.
          // ambient_sound: Adds ambient environment sound to the call.
          // language: Specifies the agent's operational language.
          // webhook_url: The webhook for the agent to listen to call events.
          // boosted_keywords: A list of keywords to bias the transcriber model.
          // format_text: Boolean to format the transcribed text with inverse text normalization.
          // retell_llm_dynamic_variables: Object to define dynamic variables for the call, allowing for customization of the call flow based on these variables.
          const callResponse = await this.retellClient.registerCall({
            agentId: agentId, // Unique ID of the agent involved in the call
            audioWebsocketProtocol: AudioWebsocketProtocol.Twilio, // Using Twilio's websocket protocol
            audioEncoding: AudioEncoding.Mulaw, // Audio encoding set to Mulaw, suitable for telephony
            sampleRate: 8000, // Sample rate set to 8000 Hz, standard for phone calls
            // opt_out_sensitive_data_storage: false,
            // llm_websocket_url: "wss://your-websocket-endpoint",
            // agent_name: "Agent Name",
            // voice_id: "voiceId",
            // voice_temperature: 1,
            // voice_speed: 1,
            // responsiveness: 1,
            // enable_backchannel: false,
            // ambient_sound: "coffee-shop",
            // language: "en-US",
            // webhook_url: "https://webhook-url-here",
            // boosted_keywords: ["keyword1", "keyword2"],
            // format_text: true,
            // retell_llm_dynamic_variables: {
            //   customer_name: "John Doe",
            //   appointment_type: "annual checkup",
            // },
          });
          if (callResponse.callDetail) {
            // Start phone call websocket
            const response = new VoiceResponse();
            const start = response.connect();
            const stream = start.stream({
              url: `wss://api.retellai.com/audio-websocket/${callResponse.callDetail.callId}`,
            });
            res.set("Content-Type", "text/xml");
            res.send(response.toString());
          }
        } catch (err) {
          console.error("Error in twilio voice webhook:", err);
          res.status(500).send();
        }
      },
    );
  };
}
