@description('Deployment location')
param location string

@description('Container Apps Environment Name')
param environmentName string

@description('Delegated ACA Subnet ID')
param subnetId string

@description('Backend Container Image')
param backendImage string

@description('Frontend Container Image')
param frontendImage string

@description('Azure Log Analytics Workspace ID for ACA logging')
param logAnalyticsCustomerId string

@secure()
@description('Azure Log Analytics Workspace Shared Key')
param logAnalyticsSharedKey string

@description('Key Vault Secret Reference for Database URL')
param keyVaultDbUrlSecretId string

// Azure Container Apps Managed Environment
resource acaEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: subnetId
      internal: false
    }
    zoneRedundant: true
  }
}

// User-Assigned Managed Identity for ACA Key Vault access
resource acaIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${environmentName}-identity'
  location: location
}

// Backend Business Service Container App
resource backendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'kaizen-backend'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${acaIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: acaEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'db-url'
          keyVaultUrl: keyVaultDbUrlSecretId
          identity: acaIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'business-service'
          image: backendImage
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
          env: [
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'db-url'
            }
            {
              name: 'DATABASE_POOL_SIZE'
              value: '15'
            }
            {
              name: 'FORCE_HTTPS'
              value: 'true'
            }
            {
              name: 'ENABLE_API_DOCS'
              value: 'false'
            }
            {
              name: 'LOG_JSON'
              value: 'true'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health/live'
                port: 8000
              }
              periodSeconds: 15
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: 8000
              }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 2
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling-rule'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

// Frontend Web Client Container App
resource frontendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'kaizen-frontend'
  location: location
  properties: {
    managedEnvironmentId: acaEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'frontend-web'
          image: frontendImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              periodSeconds: 15
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 2
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling-rule'
            http: {
              metadata: {
                concurrentRequests: '200'
              }
            }
          }
        ]
      }
    }
  }
}

output backendFqdn string = backendApp.properties.configuration.ingress.fqdn
output frontendFqdn string = frontendApp.properties.configuration.ingress.fqdn
output identityPrincipalId string = acaIdentity.properties.principalId

