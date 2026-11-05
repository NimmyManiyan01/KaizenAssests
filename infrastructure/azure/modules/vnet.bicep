@description('Deployment location for networking resources')
param location string

@description('Resource name prefix')
param prefix string

@description('VNet Address space CIDR')
param vnetAddressPrefix string = '10.0.0.0/16'

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: '${prefix}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-container-apps'
        properties: {
          addressPrefix: '10.0.0.0/21'
          delegations: [
            {
              name: 'delegation-aca'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-postgresql'
        properties: {
          addressPrefix: '10.0.8.0/24'
          delegations: [
            {
              name: 'delegation-postgresql'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: '10.0.9.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

output vnetId string = vnet.id
output acaSubnetId string = '${vnet.id}/subnets/snet-container-apps'
output postgresSubnetId string = '${vnet.id}/subnets/snet-postgresql'
output privateEndpointSubnetId string = '${vnet.id}/subnets/snet-private-endpoints'

