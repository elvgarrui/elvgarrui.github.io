+++
title = 'Fun with ovs-vswitchd I: Splitting the ovs-ctl reload command into 2 scripts'
date = 2025-04-07T15:36:12+01:00
lastmodified = ""
author = "Elvira"
license = ""
license_url = ""
cover = ""    
math = false  
draft = true
+++

When we changed from plain Openstack to Openstack with an Openshift Control plane (referred as RHOSO at Red Hat), we used to have a huge problem with openvswitch updates. The packet loss was not acceptable at all.
The reason behind this is that the flow-restoration process was usually performed with the ovs-ctl reload command. *However*, things change when you are updating OVS on Openshift. We needed to update **pods** instead of restarting plain processes inside a container or a host.

