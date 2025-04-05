+++
title = 'Debugging the Network System Role'
date = 2020-06-10T21:13:12+01:00
lastmodified = ""
author = "Elvira"
license = ""
license_url = ""
cover = ""    
math = false  
draft = false
+++



On this post I want to show the current process of debugging for the network
system role and the reasons to add Pytest as tool for the integration tests,
which is my task during the summer!

### Intro to the Network Role

Since Linux System Roles is executed with Ansible, it is nice to take a look on
what [Ansible](https://docs.ansible.com/ansible/latest/index.html) is.
According to their main page: "Ansible is an IT automation tool. It can
configure systems, deploy software, and orchestrate more advanced IT tasks such
as continuous deployments or zero downtime rolling updates." 

An Ansible Role is a framework that manages collections of tasks and variables
independently. Each role has a particular functionality. This said, [Linux
System Roles](https://linux-system-roles.github.io/) are a collection of
Ansible Roles that admin the configuration of common GNU/Linux subsystems. The
aim of Linux System Roles is to give a consistent API to a Linux distribution
and making it consistent across their releases. Therefore, the Network Role is
a role capable of configuring the networks of the machines that we want to
manage through Ansible.

### Integration Testing on the Network Role

My main objective in this period is to be able to improve the testing of the
network role. Right now, the system used to make integration testing are
ansible-playbooks. These playbooks are the standard way of executing the role,
but they present some problems when being used to make these tests. 

### Current debugging workflow

So, how to proceed if the current integration tests end with errors? First of
all, since there is not a totally reliable source on the output that tells the
developer if the role had an unexpected error. Right now, the best way of
knowing this is returning the exit code of the process with the command `echo $?`.

If the output if different than 0, it means that there is something you need to
change on your code. To make further debugging, it is convenient to execute the
tests with the command:

```sh
TEST_DEBUG=1
TEST_SUBJECTS=CentOS-8-GenericCloud-8.1.1911-20200113.3.x86_64.qcow2
ansible-playbook -v -i /usr/share/ansible/inventory/standard-inventory-qcow2
playbooks/tests_ethtool_features.yml --skip-tags tests::cleanup -e
network_provider=initscripts
```

#### What does this command do?

 - `TEST_DEBUG=1` - Indicates not to remove the VM that is created for the
   testing.
 - `TEST_SUBJECTS=/path/to/virtual/machine` - Indicates which VM will be built
   to test the role.
 - `ansible-playbook -v` - The command that execute the playbooks with the flag
   verbose
 - `-i /path/to/inventory` - The inventory flag points to a script that sets
   the configuration for the testing. This script enables the variables
`TEST_DEBUG` and `TEST_SUBJECTS`.
 - `/path/to/test.yml`
 - `--skip-tags test::cleanup` - This flag indicates the playbook to not
   execute the playbook blocks that have "test::cleanup" as a tag. Adding it
   will make the changes stay on the VM. This way we can later enter the VM and
   see what went wrong.
 - `-e network_provider=initscripts` - This selects the provider we want to use
   to make the network changes. It can be either initscripts or nm.

Executing this command will perform the tests and also output the information
we need to later use the VM again, which are:

 - The ssh command to enter the VM. With this we can enter the VM  and check
   the logs of the provider we used, to get  more information on the problems
   encountered through the execution of the playbook.

 - The Ansible Inventory that can be used in case we want to execute the tests
   again with the same VM. 

An example is:

``` log
[INFO ] standard-inventory-qcow2: ssh -p 3266 -o StrictHostKeyChecking=no
-o UserKnownHostsFile=/dev/null -i /tmp/inventory-clouduyfw03ub/identity
root@127.0.0.3
[INFO ] standard-inventory-qcow2: export ANSIBLE_INVENTORY=/tmp/inventory-
clouduyfw03ub/inventory
```



### Aiming for a better integration testing

Although integration testing can be done this way, introducing a tool like
Pytest can help reduce debugging time and complexity. If Pytest is added, then
Ansible would be no longer needed for the testing, since Pytest can simulate
the changes performed by the Ansible program. Some of the benefits of using
it, among others, would be:
 
-  Pytest is a widely known tool, so using it for integration testing would
   make the project more accesible to new developers.
 
- The use of different Pytest features like fixtures can easily reduce
  writing complexity of tests and expand the coverage of the tests at the same
  time.

The introduction time to the project has helped me realize why it is important
to improve the testing of the roles. The following weeks will be a complete
challenge to me, but I think that the outcome of it will be completely worth
it, both for me and for the project. =)