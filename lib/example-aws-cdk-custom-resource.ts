import { TargetGroupProperties } from '../src/lambda/api'
import { Certificate } from '@aws-cdk/aws-certificatemanager'
import { SubnetType, Vpc } from '@aws-cdk/aws-ec2'
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
} from '@aws-cdk/aws-elasticloadbalancingv2'
import { PolicyStatement } from '@aws-cdk/aws-iam'
import { Code, Function, Runtime } from '@aws-cdk/aws-lambda'
import {
  AssetHashType,
  Construct,
  CustomResource,
  Duration,
  Stack,
  StackProps,
} from '@aws-cdk/core'
import { Provider } from '@aws-cdk/custom-resources'
import { resolve } from 'path'

export type ExampleAwsCdkCustomResourceProps = StackProps & {
  certificateArn: string
}

export class ExampleAwsCdkCustomResource extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ExampleAwsCdkCustomResourceProps
  ) {
    super(scope, id, props)

    const vpc = new Vpc(this, 'Vpc', {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [{ subnetType: SubnetType.PUBLIC, name: 'public' }],
    })

    const onEvent = new Function(this, 'control-target-group', {
      code: Code.fromAsset(resolve(__dirname, '..'), {
        assetHashType: AssetHashType.OUTPUT,
        bundling: {
          image: Runtime.NODEJS_12_X.bundlingDockerImage,
          user: 'root',
          command: [
            'bash',
            '-c',
            [
              'cp -au src package.json yarn.lock /tmp',
              'cd /tmp',
              'npm install --global yarn',
              'yarn install',
              'yarn -s esbuild src/lambda/target-group.ts --bundle --platform=node --target=node12 --outfile=/asset-output/index.js',
            ].join(' && '),
          ],
        },
      }),
      runtime: Runtime.NODEJS_12_X,
      handler: 'index.handler',
      memorySize: 512,
      timeout: Duration.minutes(14),
      initialPolicy: [
        new PolicyStatement({
          actions: ['elasticloadbalancing:*'],
          resources: ['*'],
        }),
      ],
    })
    const provider = new Provider(this, 'provider', {
      onEventHandler: onEvent,
    })
    const customResource = new CustomResource(this, 'custom-target-group', {
      serviceToken: provider.serviceToken,
      properties: {
        Name: 'grpc-tg',
        Port: 50051,
        Protocol: 'HTTP',
        ProtocolVersion: 'GRPC',
        VpcId: vpc.vpcId,
        TargetType: 'ip',
      } as TargetGroupProperties,
    })
    const grpcTargetGroup = ApplicationTargetGroup.fromTargetGroupAttributes(
      this,
      'grpc-target-group',
      {
        targetGroupArn: customResource.ref,
      }
    )

    const certificate = Certificate.fromCertificateArn(
      this,
      'certificate',
      props.certificateArn
    )

    new ApplicationLoadBalancer(this, 'alb', { vpc }).addListener(
      'grpc-listener',
      {
        protocol: ApplicationProtocol.HTTPS,
        port: 50051,
        defaultTargetGroups: [grpcTargetGroup],
        certificates: [certificate],
      }
    )
  }
}
