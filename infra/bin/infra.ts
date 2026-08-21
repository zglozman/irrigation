#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { IrrigationStack } from '../lib/irrigation-stack';

const app = new cdk.App();
new IrrigationStack(app, 'IrrigationStack', {
  // Concrete env required: the ECS section looks up the default VPC.
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '032229060883',
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
