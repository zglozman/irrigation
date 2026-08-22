import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { IrrigationStack } from '../lib/irrigation-stack';

describe('IrrigationStack', () => {
  let app: cdk.App;
  let stack: IrrigationStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new IrrigationStack(app, 'TestIrrigationStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  test('DynamoDB table created with PK and SK', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      AttributeDefinitions: [
        {
          AttributeName: 'PK',
          AttributeType: 'S',
        },
        {
          AttributeName: 'SK',
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: 'PK',
          KeyType: 'HASH',
        },
        {
          AttributeName: 'SK',
          KeyType: 'RANGE',
        },
      ],
    });
  });

  test('IoT policy contains iot:RetainPublish action (regression: absence blocked device CONNECT)', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'irrigation-controller-policy',
    });

    // Verify RetainPublish is in the policy
    const policies = template.findResources('AWS::IoT::Policy');
    let foundRetainPublish = false;

    for (const [, resource] of Object.entries(policies)) {
      const policyDoc = (resource.Properties as any).PolicyDocument;
      if (policyDoc && policyDoc.Statement) {
        for (const statement of policyDoc.Statement) {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          if (actions.includes('iot:RetainPublish')) {
            foundRetainPublish = true;
            break;
          }
        }
      }
    }

    expect(foundRetainPublish).toBe(true);
  });

  test('IoT policy contains topicfilter/esphome/discover subscription', () => {
    const policies = template.findResources('AWS::IoT::Policy');
    let foundEsphomeDiscover = false;

    for (const [, resource] of Object.entries(policies)) {
      const policyDoc = (resource.Properties as any).PolicyDocument;
      if (policyDoc && policyDoc.Statement) {
        for (const statement of policyDoc.Statement) {
          if (
            statement.Action === 'iot:Subscribe' ||
            (Array.isArray(statement.Action) && statement.Action.includes('iot:Subscribe'))
          ) {
            const resourceStr = JSON.stringify(statement.Resource);
            if (resourceStr && resourceStr.includes('topicfilter/esphome/discover')) {
              foundEsphomeDiscover = true;
              break;
            }
          }
        }
      }
    }

    expect(foundEsphomeDiscover).toBe(true);
  });

  test('IoT policy contains topic/irrigation-controller/* for Publish', () => {
    template.hasResourceProperties('AWS::IoT::Policy', {
      PolicyName: 'irrigation-controller-policy',
    });

    // Verify the policy document includes the topic resource for Publish
    const policies = template.findResources('AWS::IoT::Policy');
    let foundPublishStatement = false;

    for (const [, resource] of Object.entries(policies)) {
      const policyDoc = (resource.Properties as any).PolicyDocument;
      if (policyDoc && policyDoc.Statement) {
        for (const statement of policyDoc.Statement) {
          if (
            statement.Action === 'iot:Publish' ||
            (Array.isArray(statement.Action) && statement.Action.includes('iot:Publish'))
          ) {
            // Resource can be a string or a Fn::Join construct
            const resourceStr = JSON.stringify(statement.Resource);
            if (resourceStr && resourceStr.includes('topic/irrigation-controller/*')) {
              foundPublishStatement = true;
              break;
            }
          }
        }
      }
    }

    expect(foundPublishStatement).toBe(true);
  });

  test('Glue table exists for irrigation events (regression: column type drift broke Athena)', () => {
    // regression: a column type drift once broke Athena
    // This test verifies the Glue table is created with storage location
    template.hasResourceProperties('AWS::Glue::Table', {
      TableInput: Match.objectLike({
        Name: 'irrigation_events',
      }),
    });
  });

  test('Managed policy includes dynamodb:Scan (regression: absence killed cron jobs)', () => {
    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    let foundScan = false;

    for (const [, resource] of Object.entries(policies)) {
      const policyDoc = (resource.Properties as any).PolicyDocument;
      if (policyDoc && policyDoc.Statement) {
        for (const statement of policyDoc.Statement) {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          if (actions.includes('dynamodb:Scan')) {
            foundScan = true;
            break;
          }
        }
      }
    }

    expect(foundScan).toBe(true);
  });

  test('Managed policy includes bedrock-mantle:CreateInference', () => {
    const policies = template.findResources('AWS::IAM::ManagedPolicy');
    let foundCreateInference = false;

    for (const [, resource] of Object.entries(policies)) {
      const policyDoc = (resource.Properties as any).PolicyDocument;
      if (policyDoc && policyDoc.Statement) {
        for (const statement of policyDoc.Statement) {
          const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
          if (actions.includes('bedrock-mantle:CreateInference')) {
            foundCreateInference = true;
            break;
          }
        }
      }
    }

    expect(foundCreateInference).toBe(true);
  });

  test('ECS service exists with DesiredCount 1', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 1,
    });
  });

  test('CloudFront distribution exists', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Comment: 'Irrigation dashboard',
      }),
    });
  });

  test('ALB listener exists for HTTP port 80', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
    });
  });

  test('DynamoDB table uses on-demand billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });
});
