# Portable baseline validation

`LegacyCharacterizationNet8` compiles the unchanged legacy application and
unchanged public characterization-test source into a .NET 8 console harness.

The complete validation still builds the original .NET Framework 4.6.2 solution.
The portable harness makes the same golden-master tests runnable on machines
that have the reference assemblies but cannot launch a .NET Framework process.
It does not modify the immutable baseline tag or test logic.
