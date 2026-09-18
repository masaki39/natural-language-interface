# Load from ~/.zshrc with: eval "$(nli init zsh)". Type a request after the tool name and press Ctrl-X Ctrl-N:
#   gh リポジトリ一覧を取得   →   gh repo list
# The line is replaced with the suggestion and nothing runs until you press Enter.
nli-widget() {
  local tool=${BUFFER%% *} request=${BUFFER#* }
  [[ -z $tool || $request == $BUFFER ]] && return
  zle -M "nli: thinking..."
  zle -R
  local suggestion
  suggestion=$(nli "$tool" "$request" --pick </dev/tty 2>/dev/null) || { zle -M "nli: no suggestion"; return; }
  BUFFER=$suggestion
  CURSOR=${#BUFFER}
  zle -M ""
}
zle -N nli-widget
bindkey '^X^N' nli-widget
