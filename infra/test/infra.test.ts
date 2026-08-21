import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
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

  test('IoT policy contains correct topic/irrigation-controller/* for Publish', () => {
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
});
