// Test setup: configure environment variables before imports
process.env.AWS_REGION = "us-east-1";
process.env.TABLE_NAME = "IrrigationApp";
process.env.DATA_BUCKET = "irrigation-data";
process.env.ATHENA_DB = "irrigation";
process.env.ATHENA_TABLE = "irrigation_events";
process.env.ATHENA_OUTPUT = "s3://irrigation-data/athena-results/";
process.env.COGNITO_USER_POOL_ID = "us-east-1_test12345";
process.env.COGNITO_CLIENT_ID = "test-client-id";
process.env.COGNITO_CLIENT_SECRET = "test-client-secret";
process.env.IOT_TOPIC_PREFIX = "irrigation-controller";
process.env.LATITUDE = "40.7128";
process.env.LONGITUDE = "-74.0060";
process.env.TIMEZONE = "America/New_York";
process.env.SUPPLY_CAPACITY_GPH = "600";
