let
  pkgs = import <nixpkgs> {};
  unstable = import <nixos-unstable> {
    config.allowUnfree = true;
  };
in

pkgs.mkShell {
  packages = with pkgs; [
    nodejs
    unstable.opencode
  ];
}