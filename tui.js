#!/usr/bin/env node

import blessed from 'blessed';
import fetch from 'node-fetch';

class ChatNode {
    constructor(id, role, content, timestamp, parentId = null) {
        this.id = id;
        this.role = role;
        this.content = content || '';
        this.timestamp = timestamp || Date.now();
        this.parentId = parentId;
        this.children = [];
        this.isSelected = false;
    }
}

class ChatTree {
    constructor() {
        this.nodes = new Map();
        this.rootNodes = [];
        this.selectedNodeId = null;
        this.nextId = 1;
    }

    addNode(role, content, parentId = null) {
        if (!role || !content) {
            console.error('Invalid node data:', { role, content, parentId });
            return null;
        }
        
        const id = this.nextId++;
        const node = new ChatNode(id, role, content, Date.now(), parentId);
        
        this.nodes.set(id, node);
        
        if (parentId) {
            const parent = this.nodes.get(parentId);
            if (parent) {
                parent.children.push(id);
            }
        } else {
            this.rootNodes.push(id);
        }
        
        return id;
    }

    getNode(id) {
        return this.nodes.get(id);
    }

    getSelectedNode() {
        return this.selectedNodeId ? this.nodes.get(this.selectedNodeId) : null;
    }

    selectNode(id) {
        if (this.selectedNodeId) {
            const prevNode = this.nodes.get(this.selectedNodeId);
            if (prevNode) prevNode.isSelected = false;
        }
        
        this.selectedNodeId = id;
        if (id) {
            const node = this.nodes.get(id);
            if (node) node.isSelected = true;
        }
    }

    getNextNode(currentId, direction) {
        if (!currentId) {
            return this.rootNodes.length > 0 ? this.rootNodes[0] : null;
        }

        const current = this.nodes.get(currentId);
        if (!current) return null;

        if (direction === 'down') {
            // Find next sibling or next node at same level
            if (current.parentId) {
                const parent = this.nodes.get(current.parentId);
                const siblingIndex = parent.children.indexOf(currentId);
                if (siblingIndex < parent.children.length - 1) {
                    return parent.children[siblingIndex + 1];
                }
            }
            // Move to next root node
            const rootIndex = this.rootNodes.indexOf(currentId);
            if (rootIndex < this.rootNodes.length - 1) {
                return this.rootNodes[rootIndex + 1];
            }
        } else if (direction === 'up') {
            // Find previous sibling or previous node at same level
            if (current.parentId) {
                const parent = this.nodes.get(current.parentId);
                const siblingIndex = parent.children.indexOf(currentId);
                if (siblingIndex > 0) {
                    return parent.children[siblingIndex - 1];
                }
            }
            // Move to previous root node
            const rootIndex = this.rootNodes.indexOf(currentId);
            if (rootIndex > 0) {
                return this.rootNodes[rootIndex - 1];
            }
        } else if (direction === 'right') {
            // Move to first child
            if (current.children.length > 0) {
                return current.children[0];
            }
        } else if (direction === 'left') {
            // Move to parent
            return current.parentId;
        }

        return currentId;
    }

    getAllNodes() {
        return Array.from(this.nodes.values());
    }
}

class ChatTUI {
    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Tree-Based Chat TUI Interface'
        });

        this.chatTree = new ChatTree();
        this.isStreaming = false;
        this.editingNodeId = null;
        
        this.setupUI();
        this.setupEventHandlers();
        
        // Quit on escape, q, or Ctrl-C
        this.screen.key(['escape', 'q', 'C-c'], () => {
            process.exit(0);
        });
    }

    setupUI() {
        // Create header
        this.header = blessed.box({
            top: 0,
            left: 0,
            width: '100%',
            height: 3,
            content: 'Chat Tree TUI | Arrow Keys: Navigate | Enter: Edit Message | Ctrl+Tab: Switch Focus | q: Quit',
            style: {
                fg: 'white',
                bg: 'blue',
                bold: true
            },
            border: {
                type: 'line'
            }
        });

        // Create main tree visualization area (like lazygit commits panel)
        this.treeBox = blessed.box({
            top: 3,
            left: 0,
            width: '100%',
            height: '85%',
            scrollable: true,
            scrollbar: {
                ch: ' ',
                style: {
                    bg: 'blue'
                }
            },
            style: {
                fg: 'white',
                bg: 'black'
            },
            border: {
                type: 'line'
            },
            label: ' Chat Tree '
        });

        // Create input area
        this.inputBox = blessed.textarea({
            bottom: 0,
            left: 0,
            width: '100%',
            height: 3,
            value: '',
            inputOnFocus: true,
            keys: true,
            vi: false,
            mouse: true,
            alwaysScroll: true,
            scrollable: true,
            style: {
                fg: 'white',
                bg: 'black',
                border: {
                    fg: 'blue'
                }
            },
            border: {
                type: 'line'
            },
            label: ' Message Input (Enter to send, Ctrl+C to quit) '
        });

        // Create status bar
        this.statusBar = blessed.box({
            bottom: 3,
            left: 0,
            width: '100%',
            height: 1,
            content: 'Ready - Use arrow keys to navigate the chat tree',
            style: {
                fg: 'yellow',
                bg: 'black'
            }
        });

        // Append all elements to screen
        this.screen.append(this.header);
        this.screen.append(this.treeBox);
        this.screen.append(this.inputBox);
        this.screen.append(this.statusBar);

        // Focus on input box by default for typing
        this.inputBox.focus();
        
        // Initialize with a welcome message
        this.initializeChat();
        
        // Ensure input box is properly configured for text input
        this.inputBox.setValue('');
    }

    setupEventHandlers() {
        // Tree navigation (when tree is focused)
        this.treeBox.key(['up', 'down', 'left', 'right'], (ch, key) => {
            this.navigateTree(key.name);
        });

        // Enter to edit selected message (when tree is focused)
        this.treeBox.key(['enter'], () => {
            this.startEditing();
        });

        // Ctrl+Tab to switch focus between tree and input
        this.treeBox.key(['C-tab'], () => {
            this.inputBox.focus();
            this.inputBox.setValue(this.inputBox.getValue() || ''); // Ensure input is visible
        });

        this.inputBox.key(['C-tab'], () => {
            this.treeBox.focus();
        });

        // Input handling
        this.inputBox.key(['enter'], () => {
            if (this.editingNodeId) {
                this.submitEdit();
            } else {
                this.sendNewMessage();
            }
        });

        this.inputBox.key(['escape'], () => {
            if (this.editingNodeId) {
                this.cancelEdit();
            }
        });

        this.inputBox.key(['C-c'], () => {
            process.exit(0);
        });

        // Ensure input box captures all keystrokes
        this.inputBox.on('keypress', (ch, key) => {
            // This ensures the input box captures all keystrokes
        });

        // Global key handlers for quick actions
        this.screen.key(['C-n'], () => {
            // Ctrl+N to focus input for new message
            this.inputBox.focus();
        });

        this.screen.key(['C-t'], () => {
            // Ctrl+T to focus tree for navigation
            this.treeBox.focus();
        });

        // Alternative focus switching keys
        this.screen.key(['C-i'], () => {
            // Ctrl+I to focus input
            this.inputBox.focus();
        });

        this.screen.key(['C-o'], () => {
            // Ctrl+O to focus tree
            this.treeBox.focus();
        });
    }

    initializeChat() {
        // Add initial system message
        const systemId = this.chatTree.addNode('system', 'Welcome to the Tree-Based Chat Interface!');
        this.chatTree.selectNode(systemId);
        this.updateDisplay();
    }

    navigateTree(direction) {
        const currentNodeId = this.chatTree.selectedNodeId;
        const nextNodeId = this.chatTree.getNextNode(currentNodeId, direction);
        
        if (nextNodeId && nextNodeId !== currentNodeId) {
            this.chatTree.selectNode(nextNodeId);
            this.updateDisplay();
        }
    }

    startEditing() {
        const selectedNode = this.chatTree.getSelectedNode();
        if (selectedNode && selectedNode.role !== 'system') {
            this.editingNodeId = selectedNode.id;
            this.inputBox.setValue(selectedNode.content);
            this.inputBox.focus();
            this.updateStatus(`Editing message ${selectedNode.id}...`);
        }
    }

    submitEdit() {
        const newContent = this.inputBox.getValue().trim();
        if (newContent) {
            const originalNode = this.chatTree.getNode(this.editingNodeId);
            if (originalNode && originalNode.content !== newContent) {
                // Create a new branch from the same parent
                const newId = this.chatTree.addNode(originalNode.role, newContent, originalNode.parentId);
                if (newId) {
                    this.chatTree.selectNode(newId);
                    
                    // Send to LLM to get response
                    this.sendMessageToLLM(newContent, newId);
                }
            }
        }
        
        this.cancelEdit();
    }

    cancelEdit() {
        this.editingNodeId = null;
        this.inputBox.setValue('');
        this.treeBox.focus();
        this.updateStatus('Edit cancelled');
        this.updateDisplay();
    }

    sendNewMessage() {
        const message = this.inputBox.getValue().trim();
        if (message) {
            // Add user message as a new root node
            const userMessageId = this.chatTree.addNode('user', message);
            if (userMessageId) {
                this.chatTree.selectNode(userMessageId);
                
                // Send to LLM
                this.sendMessageToLLM(message, userMessageId);
                
                this.inputBox.setValue('');
                this.updateDisplay();
            }
        }
    }

    async sendMessageToLLM(message, parentMessageId) {
        if (this.isStreaming) {
            this.updateStatus('Already processing a message...');
            return;
        }

        this.isStreaming = true;
        this.updateStatus('Connecting to LLM...');

        try {
            const response = await this.callLLM(message);
            
            // Add assistant response as child of the user message
            const assistantId = this.chatTree.addNode('assistant', response, parentMessageId);
            this.chatTree.selectNode(assistantId);
            
            this.updateStatus('Message sent successfully');
        } catch (error) {
            this.updateStatus(`Error: ${error.message}`);
        } finally {
            this.isStreaming = false;
        }

        this.updateDisplay();
    }

    async callLLM(message) {
        const response = await fetch('http://localhost:1234/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: 'Be a helpful assistant' },
                    { role: 'user', content: message }
                ],
                temperature: 0.7,
                max_tokens: -1,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    updateDisplay() {
        this.updateTreeDisplay();
        this.screen.render();
    }

    updateTreeDisplay() {
        let treeContent = '';
        
        if (this.chatTree.rootNodes.length === 0) {
            treeContent = 'No messages yet. Start typing to begin!';
        } else {
            const renderNode = (nodeId, level = 0, isLast = true) => {
                const node = this.chatTree.getNode(nodeId);
                if (!node || !node.content) return '';
                
                // Format like lazygit: ID | Role | Timestamp | Content preview
                const nodeIdStr = node.id.toString().padStart(4, '0');
                const roleLabel = node.role === 'user' ? 'User' : (node.role === 'assistant' ? 'Asst' : 'Sys');
                const timestamp = new Date(node.timestamp).toLocaleTimeString();
                const contentPreview = node.content.length > 50 ? node.content.substring(0, 50) + '...' : node.content;
                
                // Selection indicator
                const selectionMarker = node.isSelected ? '▶ ' : '  ';
                
                // Tree structure visualization
                let treeLine = '';
                if (level === 0) {
                    treeLine = '● '; // Root node
                } else {
                    treeLine = '  '.repeat(level - 1) + (isLast ? '└─' : '├─') + ' ';
                }
                
                const nodeLine = `${selectionMarker}${treeLine}${nodeIdStr} | ${roleLabel} | ${timestamp} | ${contentPreview}\n`;
                treeContent += nodeLine;
                
                // Render children (assistant responses)
                if (node.children && node.children.length > 0) {
                    for (let i = 0; i < node.children.length; i++) {
                        const isLastChild = i === node.children.length - 1;
                        const childContent = renderNode(node.children[i], level + 1, isLastChild);
                        if (childContent) {
                            treeContent += childContent;
                        }
                    }
                }
            };
            
            // Render all root nodes (user messages and system messages)
            for (let i = 0; i < this.chatTree.rootNodes.length; i++) {
                const isLast = i === this.chatTree.rootNodes.length - 1;
                const rootContent = renderNode(this.chatTree.rootNodes[i], 0, isLast);
                if (rootContent) {
                    treeContent += rootContent;
                }
            }
        }
        
        this.treeBox.setContent(treeContent);
    }



    updateStatus(message) {
        const selectedNode = this.chatTree.getSelectedNode();
        let statusContent = message;
        
        if (selectedNode) {
            statusContent += ` | Selected: ${selectedNode.role} message #${selectedNode.id} | ${selectedNode.content.substring(0, 40)}...`;
        }
        
        // Add focus indicator
        const focusedElement = this.screen.focused;
        if (focusedElement === this.inputBox) {
            statusContent += ' | [INPUT MODE]';
        } else if (focusedElement === this.treeBox) {
            statusContent += ' | [NAVIGATION MODE]';
        }
        
        this.statusBar.setContent(statusContent);
        this.screen.render();
    }

    start() {
        this.screen.render();
        this.updateStatus('Tree-Based Chat TUI Ready - Use arrow keys to navigate');
    }
}

// Start the TUI
const tui = new ChatTUI();
tui.start();
