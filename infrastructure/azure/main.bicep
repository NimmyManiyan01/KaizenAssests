// ==============================================================================
// Azure Infrastructure as Code Master Blueprint for Kaizen WMS (CHG-AZ-003, CHG-AZ-005)
// Provisions VNet, PostgreSQL Flexible Server, Key Vault, Storage, and Container Apps.
// ==============================================================================
targetScope = 'resourceGroup'

@description('Deployment environment')
@allowed([
  'staging'
  'prod'
])
param environment string = 'prod'

@description('Primary deployment Azure region')
param location string = resourceGroup().location

@description('Resource name prefix')
param prefix string = 'kaizen-wms-${environment}'

@secure()
@description('Administrator password for Azure Database for PostgreSQL')
param dbAdminPassword string

@description('Backend container image with tag')
param backendImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@description('Frontend container image with tag')
param frontendImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

// 1. Virtual Network & Subnets
module network 'modules/vnet.bicep' = {
  name: 'networkDeployment'
  params: {
    location: location
    prefix: prefix
  }
}

// 2. Azure Key Vault
module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVaultDeployment'
  params: {
    location: location
    keyVaultName: '${prefix}-kv'
  }
}

// 3. Azure Storage Account (Blob Storage for media/documents)
module storage 'modules/storage.bicep' = {
  name: 'storageDeployment'
  params: {
    location: location
    storageAccountName: replace('${prefix}sa', '-', '')
  }
}

// 4. Azure Database for PostgreSQL Flexible Server
module postgres 'modules/postgresql.bicep' = {
  name: 'postgresDeployment'
  params: {
    location: location
    serverName: '${prefix}-psql'
    adminLogin: 'ams_admin'
    adminPassword: dbAdminPassword
    skuName: environment == 'prod' ? 'Standard_D2ds_v5' : 'Standard_B2s'
    subnetId: network.outputs.postgresSubnetId
  }
}

// 5. Azure Container Apps Managed Environment & Workloads
module containerApps 'modules/container-apps.bicep' = {
  name: 'containerAppsDeployment'
  params: {
    location: location
    environmentName: '${prefix}-aca-env'
    subnetId: network.outputs.acaSubnetId
    backendImage: backendImage
    frontendImage: frontendImage
    logAnalyticsCustomerId: ''
    logAnalyticsSharedKey: ''
    keyVaultDbUrlSecretId: '${keyVault.outputs.keyVaultUri}secrets/database-url'
  }
}

output backendUrl string = 'https://${containerApps.outputs.backendFqdn}'
output frontendUrl string = 'https://${containerApps.outputs.frontendFqdn}'
output postgresHost string = postgres.outputs.fullyQualifiedDomainName
output keyVaultUri string = keyVault.outputs.keyVaultUri
output storageBlobEndpoint string = storage.outputs.blobEndpoint

