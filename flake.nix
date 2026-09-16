{
  description = "Helicode - Helix keybindings for VS Code";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pkgs.git
            pkgs.jq
            pkgs.tree-sitter
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export npm_config_update_notifier=false
            echo "helicode dev shell: node $(node --version), npm $(npm --version)"
          '';
        };
      });
}
