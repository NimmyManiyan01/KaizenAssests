@description('Deployment location')
param location string

@description('PostgreSQL Server Name')
param serverName string

@description('PostgreSQL Administrator Login')
param adminLogin string = 'ams_admin'

@secure()
@description('PostgreSQL Administrator Password')
param adminPassword string

@description('PostgreSQL Compute SKU')
param skuName string = 'Standard_D2ds_v5'

@description('PostgreSQL Storage Size in GB')
param storageSizeGB int = 128

@description('PostgreSQL Version')
param version string = '16'

@description('Delegated Subnet ID for PostgreSQL Flexible Server')
param subnetId string

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: 'GeneralPurpose'
  }
  properties: {
    version: version
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    network: {
      delegatedSubnetResourceId: subnetId
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    highAvailability: {
      mode: 'ZoneRedundant'
    }
    backup: {
      backupRetentionDays: 35
      geoRedundantBackup: 'Disabled'
    }
  }
}

// Enable built-in connection pooler (PgBouncer)
resource pgbouncerConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-03-01-preview' = {
  parent: postgresServer
  name: 'pgbouncer.enabled'
  properties: {
    value: 'true'
    source: 'user-override'
  }
}

// Enforce TLS 1.3
resource tlsConfig 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-03-01-preview' = {
  parent: postgresServer
  name: 'ssl_min_protocol_version'
  properties: {
    value: 'TLSv1.3'
    source: 'user-override'
  }
}

// Production database creation
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: postgresServer
  name: 'ams_business'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

output serverId string = postgresServer.id
output fullyQualifiedDomainName string = postgresServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
output adminUsername string = adminLogin

