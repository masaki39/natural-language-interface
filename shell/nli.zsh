# Load from ~/.zshrc with: eval "$(nli init zsh)"
#
#   nli gh リポジトリ一覧 <Enter>   →   gh repo list      (set NLI_ENTER=0 before the eval to opt out)
#   gh リポジトリ一覧 <Ctrl-X Ctrl-N> →   gh repo list      (or $NLI_KEY, set before the eval)
#
# The line is replaced with the suggestion and nothing runs until you press Enter again.

# Replace "<tool> <request>" (an optional leading "nli" is dropped) with nli's suggestion.
nli-widget() {
  local line=${BUFFER#nli }
  local tool=${line%% *} request=${line#* }
  if [[ -z $tool || $request == $line ]]; then
    zle -M "nli: type a tool and a request first, e.g. gh リポジトリ一覧"
    return
  fi
  zle -M "nli: thinking..."
  zle -R
  local suggestion err=${TMPDIR:-/tmp}/nli-widget.$$
  if suggestion=$(nli "$tool" "$request" --pick </dev/tty 2>$err); then
    print -s -- "$BUFFER"
    BUFFER=$suggestion
    CURSOR=${#BUFFER}
    zle -M ""
  else
    zle -M "$(tail -n 1 $err)"
  fi
  rm -f $err
}
zle -N nli-widget
bindkey "${NLI_KEY:-^X^N}" nli-widget
bindkey -M vicmd "${NLI_KEY:-^X^N}" nli-widget

# Enter on "nli <tool> <request>" suggests instead of running. Lines with options
# (nli gh ... --explain) and nli's own commands (nli list, nli init) run as usual.
# The builtin .accept-line is called directly: plugins such as zsh-autosuggestions wrap whatever
# accept-line is, so they still run around this widget, and loading this file twice is harmless.
if [[ ${NLI_ENTER:-1} != 0 ]]; then
  nli-accept-line() {
    local -a words=(${(z)BUFFER})
    if [[ ${words[1]} == nli && ${#words} -ge 3 && ${words[2]} != (list|init) && -z ${(M)words:#-*} ]]; then
      zle nli-widget
    else
      zle .accept-line
    fi
  }
  zle -N accept-line nli-accept-line
fi
