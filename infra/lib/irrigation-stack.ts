import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';

export class IrrigationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==================== Cognito User Pool ====================
    const userPool = new cognito.UserPool(this, 'IrrigationUserPool', {
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
    });

    const appClient = userPool.addClient('IrrigationAppClient', {
      authFlows: {
        userPassword: true,
      },
      enableTokenRevocation: true,
      generateSecret: true,
    });

    // ==================== DynamoDB Table ====================
    const table = new dynamodb.Table(this, 'IrrigationAppTable', {
      tableName: 'IrrigationApp',
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });

    // ==================== Data S3 Bucket ====================
    const dataBucket = new s3.Bucket(this, 'IrrigationDataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
      enforceSSL: true,
    });

    // ==================== Firmware S3 Bucket ====================
    const firmwareBucket = new s3.Bucket(this, 'IrrigationFirmwareBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
      enforceSSL: true,
      publicReadAccess: true,
    });

    // ==================== Glue Database ====================
    const glueDatabase = new glue.CfnDatabase(this, 'IrrigationGlueDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'irrigation',
      },
    });

    // ==================== Glue Table with Partition Projection ====================
    // Use L1 construct to set partition projection parameters
    new glue.CfnTable(this, 'IrrigationEventsTable', {
      catalogId: this.account,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'irrigation_events',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'projection.enabled': 'true',
          'projection.year.type': 'integer',
          'projection.year.range': '2025,2100',
          'projection.month.type': 'integer',
          'projection.month.range': '1,12',
          'projection.month.digits': '2',
          'projection.day.type': 'integer',
          'projection.day.range': '1,31',
          'projection.day.digits': '2',
          'projection.zone.type': 'integer',
          'projection.zone.range': '1,16',
          'projection.zone.digits': '2',
          'storage.location.template': `s3://${dataBucket.bucketName}/irrigation-events/year=\${year}/month=\${month}/day=\${day}/zone=\${zone}`,
          'classification': 'json',
        },
        storageDescriptor: {
          columns: [
            { name: 'zone_id', type: 'string' },
            { name: 'timestamp', type: 'string' },
            { name: 'trigger_type', type: 'string' },
            { name: 'scheduled_runtime_min', type: 'double' },
            { name: 'actual_runtime_min', type: 'double' },
            { name: 'gallons_estimated_delivered', type: 'double' },
            { name: 'weekly_target_gal', type: 'double' },
            { name: 'remaining_before', type: 'double' },
            { name: 'remaining_after', type: 'double' },
            { name: 'rainfall_measured_in', type: 'double' },
            { name: 'rainfall_gal_equiv', type: 'double' },
            { name: 'weather_snapshot', type: 'string' },
            { name: 'outcome', type: 'string' },
            { name: 'reason', type: 'string' },
          ],
          location: `s3://${dataBucket.bucketName}/irrigation-events/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          },
        },
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
          { name: 'zone', type: 'string' },
        ],
      },
    });

    // ==================== IoT Core ====================
    const iotThing = new iot.CfnThing(this, 'IrrigationController', {
      thingName: 'irrigation-controller',
    });

    const iotPolicy = new iot.CfnPolicy(this, 'IrrigationIoTPolicy', {
      policyName: 'irrigation-controller-policy',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'iot:Connect',
            Resource: `arn:aws:iot:${this.region}:${this.account}:client/irrigation-controller`,
          },
          {
            Effect: 'Allow',
            Action: 'iot:Subscribe',
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/irrigation-controller/*`,
              // ESPHome always subscribes to the global dashboard-discovery
              // topic (even with discovery: false); AWS IoT drops the whole
              // connection on an unauthorized SUBSCRIBE.
              `arn:aws:iot:${this.region}:${this.account}:topicfilter/esphome/discover`,
            ],
          },
          {
            Effect: 'Allow',
            // RetainPublish: ESPHome's birth/last-will status message is
            // retained; AWS IoT refuses the whole CONNECT without it.
            Action: ['iot:Publish', 'iot:Receive', 'iot:RetainPublish'],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topic/irrigation-controller/*`,
              `arn:aws:iot:${this.region}:${this.account}:topic/esphome/discover`,
            ],
          },
        ],
      },
    });

    // ==================== IAM User ====================
    const iamUser = new iam.User(this, 'IrrigationAppUser', {
      userName: 'irrigation-app',
    });

    // Customer-managed policy for the app (shared by the IAM user and the
    // ECS task role; inline user policies are capped at 2048 bytes).
    const appPolicy = new iam.ManagedPolicy(this, 'IrrigationAppManagedPolicy', {
      statements: [
        // DynamoDB permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [table.tableArn],
        }),

        // S3 permissions for data bucket
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject'],
          resources: [`${dataBucket.bucketArn}/irrigation-events/*`],
        }),

        // S3 permissions for athena results in data bucket
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${dataBucket.bucketArn}/athena-results/*`],
        }),

        // S3 ListBucket with prefix condition for athena results and irrigation events
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [dataBucket.bucketArn],
          conditions: {
            StringLike: {
              's3:prefix': ['athena-results/*', 'irrigation-events/*'],
            },
          },
        }),

        // S3 GetBucketLocation for Athena
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetBucketLocation'],
          resources: [dataBucket.bucketArn],
        }),

        // S3 GetObject for Athena to read irrigation events
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: [`${dataBucket.bucketArn}/irrigation-events/*`],
        }),

        // S3 permissions for firmware bucket
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject'],
          resources: [`${firmwareBucket.bucketArn}/*`],
        }),

        // Athena permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'athena:StartQueryExecution',
            'athena:GetQueryExecution',
            'athena:GetQueryResults',
          ],
          resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/primary`],
        }),

        // Glue permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['glue:GetDatabase', 'glue:GetTable', 'glue:GetPartitions'],
          resources: [
            `arn:aws:glue:${this.region}:${this.account}:catalog`,
            `arn:aws:glue:${this.region}:${this.account}:database/irrigation`,
            `arn:aws:glue:${this.region}:${this.account}:table/irrigation/irrigation_events`,
          ],
        }),

        // Bedrock — chat assistant invokes Claude (model access must also be
        // enabled for Anthropic models in the Bedrock console for this region)
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
            // The Anthropic Mantle client (Messages-API Bedrock endpoint)
            // authorizes against its own action/resource namespace.
            'bedrock-mantle:CreateInference',
          ],
          resources: [
            `arn:aws:bedrock:*::foundation-model/anthropic.*`,
            `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
            `arn:aws:bedrock-mantle:*:${this.account}:project/*`,
          ],
        }),

        // IoT permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iot:DescribeEndpoint'],
          resources: ['*'],
        }),

        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['iot:Publish'],
          resources: [
            `arn:aws:iot:${this.region}:${this.account}:topic/irrigation-controller/*`,
          ],
        }),

        // Cognito permissions
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminGetUser',
          ],
          resources: [userPool.userPoolArn],
        }),
      ],
    });

    appPolicy.attachToUser(iamUser);

    // ==================== ECS Fargate + ALB + CloudFront ====================
    // One always-on container in the default VPC; the same image runs on
    // Unraid via docker-compose. HTTPS comes from CloudFront's default cert.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const cluster = new ecs.Cluster(this, 'IrrigationCluster', {
      vpc,
      clusterName: 'irrigation',
    });

    const taskRole = new iam.Role(this, 'IrrigationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Runtime role for the irrigation app container (same policy as the irrigation-app user)',
    });
    appPolicy.attachToRole(taskRole);

    const taskDef = new ecs.FargateTaskDefinition(this, 'IrrigationTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole,
    });

    const clientSecretParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'CognitoClientSecretParam', { parameterName: '/irrigation/cognito-client-secret' }
    );
    const tomorrowKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'TomorrowApiKeyParam', { parameterName: '/irrigation/tomorrow-api-key' }
    );

    const repo = ecr.Repository.fromRepositoryName(this, 'IrrigationCloudRepo', 'irrigation-cloud');

    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'irrigation',
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
      environment: {
        NODE_ENV: 'production',
        AWS_REGION: this.region,
        TABLE_NAME: table.tableName,
        DATA_BUCKET: dataBucket.bucketName,
        ATHENA_DB: 'irrigation',
        ATHENA_TABLE: 'irrigation_events',
        ATHENA_OUTPUT: `s3://${dataBucket.bucketName}/athena-results/`,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: appClient.userPoolClientId,
        IOT_TOPIC_PREFIX: 'irrigation-controller',
        CHAT_MODEL: 'anthropic.claude-opus-5',
        LATITUDE: '29.803436',
        LONGITUDE: '-82.320328',
        TIMEZONE: 'America/New_York',
        TZ: 'America/New_York',
        SUPPLY_CAPACITY_GPH: '600',
      },
      secrets: {
        COGNITO_CLIENT_SECRET: ecs.Secret.fromSsmParameter(clientSecretParam),
        TOMORROW_API_KEY: ecs.Secret.fromSsmParameter(tomorrowKeyParam),
      },
    });

    const serviceSg = new ec2.SecurityGroup(this, 'IrrigationServiceSg', {
      vpc,
      description: 'Irrigation app tasks - ALB ingress only',
    });

    const service = new ecs.FargateService(this, 'IrrigationService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true, // default VPC has no NAT; tasks need egress for AWS APIs
      securityGroups: [serviceSg],
      // Stop-then-start on deploys: the in-process scheduler must never run
      // in two tasks at once.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
    });

    const albSg = new ec2.SecurityGroup(this, 'IrrigationAlbSg', {
      vpc,
      description: 'Irrigation ALB - CloudFront ingress only',
    });
    // AWS-managed prefix list: cloudfront.origin-facing (us-east-1)
    albSg.addIngressRule(ec2.Peer.prefixList('pl-3b927c52'), ec2.Port.tcp(80), 'CloudFront only');
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB to app');

    const alb = new elbv2.ApplicationLoadBalancer(this, 'IrrigationAlb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });
    const listener = alb.addListener('Http', { port: 80, open: false });
    listener.addTargets('App', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/login',
        healthyHttpCodes: '200-399',
      },
      deregistrationDelay: cdk.Duration.seconds(10),
    });

    const distribution = new cloudfront.Distribution(this, 'IrrigationDistribution', {
      comment: 'Irrigation dashboard',
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Irrigation dashboard (CloudFront)',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS (origin; locked to CloudFront ingress)',
    });

    // Both security groups intentionally allow all egress (AWS API calls,
    // weather APIs); acknowledge the cfn-guard F3031 lint.
    cdk.Annotations.of(serviceSg).acknowledgeWarning('CloudFormation-Validate::F3031');
    cdk.Annotations.of(albSg).acknowledgeWarning('CloudFormation-Validate::F3031');

    // ==================== Outputs ====================
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'AppClientId', {
      value: appClient.userPoolClientId,
      description: 'Cognito App Client ID',
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB Table Name',
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'Data S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'FirmwareBucketName', {
      value: firmwareBucket.bucketName,
      description: 'Firmware S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'IoTThingName', {
      value: iotThing.thingName!,
      description: 'IoT Core Thing Name',
    });

    new cdk.CfnOutput(this, 'IAMUserName', {
      value: iamUser.userName,
      description: 'IAM User Name for the app',
    });

    new cdk.CfnOutput(this, 'IoTEndpointNote', {
      value: 'Run: aws iot describe-endpoint --endpoint-type iot:Data-ATS',
      description: 'Command to fetch IoT Core data endpoint',
    });
  }
}
