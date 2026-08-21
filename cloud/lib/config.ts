// Configuration from environment variables
// AWS credentials use the SDK's default chain (env vars, IAM role, etc.)

export const config = {
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    // AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are handled by SDK default chain
    tableName: process.env.TABLE_NAME || "IrrigationApp",
    dataBucket: process.env.DATA_BUCKET || "irrigation-data",
    athenaDb: process.env.ATHENA_DB || "irrigation",
    athenaTable: process.env.ATHENA_TABLE || "irrigation_events",
    athenaOutput: process.env.ATHENA_OUTPUT || "s3://irrigation-data/athena-results/",
  },

  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
    clientSecret: process.env.COGNITO_CLIENT_SECRET,
  },

  iot: {
    topicPrefix: process.env.IOT_TOPIC_PREFIX || "irrigation-controller",
  },

  weather: {
    tomorrowApiKey: process.env.TOMORROW_API_KEY,
    tempestToken: process.env.TEMPEST_TOKEN,
    tempestStationId: process.env.TEMPEST_STATION_ID,
    tempestDeviceId: process.env.TEMPEST_DEVICE_ID,
  },

  location: {
    latitude: parseFloat(process.env.LATITUDE || "40.7128"),
    longitude: parseFloat(process.env.LONGITUDE || "-74.0060"),
    timezone: process.env.TIMEZONE || "America/New_York",
  },

  system: {
    supplyCapacityGph: parseInt(process.env.SUPPLY_CAPACITY_GPH || "600", 10),
  },
};

// Validation for required fields
export function validateConfig(): string[] {
  const errors: string[] = [];

  if (!config.cognito.userPoolId) errors.push("COGNITO_USER_POOL_ID is required");
  if (!config.cognito.clientId) errors.push("COGNITO_CLIENT_ID is required");
  if (!config.cognito.clientSecret) errors.push("COGNITO_CLIENT_SECRET is required");
  if (!config.weather.tomorrowApiKey) errors.push("TOMORROW_API_KEY is required");

  return errors;
}
